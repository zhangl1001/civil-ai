import { appLifecycleAdapter } from '@/platform/AppLifecycleAdapter';
import { AI_CONFIG_CHANGED_EVENT, aiConfigService } from '@/services/AIConfigService';
import {
  AdaptiveAgentConcurrency,
  AgentRunSuspendedError,
  agentExecutionClassesForLane,
  agentWorkPoolsForLane,
  DEFAULT_MAX_CONCURRENT_AGENT_RUNS,
  isAgentRunSuspended,
} from '@/modules/agent/public';
import type { TutorDatabaseRuntime } from '../database/createTutorDatabaseRuntime';
import { tutorDatabaseLifecycleCoordinator } from '../database/TutorDatabaseLifecycleCoordinator';
import {
  createConfiguredProviderGateway,
  ProviderConfigurationError
} from '../ai/createConfiguredProviderGateway';
import { Capacitor } from '@capacitor/core';
import { runWithAgentWorkerLeadership } from './AgentWorkerLeadership';

const WORKER_POLL_INTERVAL_MS = 1_000;
const WORKER_LEASE_MS = 60_000;

/**
 * Owns the single local Agent worker loop for both Web and native shells.
 * Re-entering the app only wakes this coordinator; it never creates a second runner.
 */
export class AgentWorkerCoordinator {
  private runtime?: TutorDatabaseRuntime;
  private worker?: Promise<void>;
  private removeLifecycleListener?: () => void;
  private activeController?: AbortController;
  private wakeRequested = false;
  private suspended = appLifecycleAdapter.current().state !== 'active';
  private providerConfigurationPaused = false;
  private configurationWarningReported = false;
  private configurationListenerInstalled = false;
  private concurrency = new AdaptiveAgentConcurrency(DEFAULT_MAX_CONCURRENT_AGENT_RUNS);

  install(runtime: TutorDatabaseRuntime): void {
    this.runtime = runtime;
    if (!this.removeLifecycleListener) {
      this.removeLifecycleListener = appLifecycleAdapter.onChange((event) => {
        if (event.state !== 'active') {
          this.suspended = true;
          this.wakeRequested = false;
          this.activeController?.abort(new AgentRunSuspendedError());
          return;
        }
        this.suspended = false;
        if (this.worker) this.wakeRequested = true;
        else this.start();
      });
    }
    if (!this.configurationListenerInstalled) {
      window.addEventListener(AI_CONFIG_CHANGED_EVENT, () => {
        this.providerConfigurationPaused = false;
        this.configurationWarningReported = false;
        void this.refreshConcurrency().finally(() => this.start());
      });
      this.configurationListenerInstalled = true;
    }
    this.start();
  }

  start(runtime?: TutorDatabaseRuntime): void {
    if (runtime) this.runtime = runtime;
    if (!this.runtime || this.providerConfigurationPaused || this.suspended) return;
    if (this.worker) {
      this.wakeRequested = true;
      return;
    }
    this.worker = this.run(this.runtime)
      .catch((error: unknown) => {
        if (isAgentRunSuspended(error)) return;
        if (error instanceof ProviderConfigurationError) {
          this.providerConfigurationPaused = true;
          this.wakeRequested = false;
          if (!this.configurationWarningReported) {
            console.info('[AgentWorkerCoordinator] waiting for provider configuration');
            this.configurationWarningReported = true;
          }
          return;
        }
        console.warn('[AgentWorkerCoordinator] worker paused', error);
      })
      .finally(() => {
        this.worker = undefined;
        if (this.wakeRequested && !this.providerConfigurationPaused && !this.suspended) {
          this.wakeRequested = false;
          globalThis.setTimeout(() => this.start(), 0);
        }
      });
  }

  private async run(runtime: TutorDatabaseRuntime): Promise<void> {
    const controller = new AbortController();
    this.activeController = controller;
    const execute = () => this.runAsLeader(runtime, controller);
    try {
      if (Capacitor.isNativePlatform()) {
        await execute();
      } else {
        await runWithAgentWorkerLeadership(execute, controller.signal);
      }
    } catch (error) {
      controller.abort(error);
      throw error;
    } finally {
      if (this.activeController === controller) this.activeController = undefined;
    }
  }

  private async runAsLeader(runtime: TutorDatabaseRuntime, controller: AbortController): Promise<void> {
    const signal = controller.signal;
    await tutorDatabaseLifecycleCoordinator.waitUntilReady();
    await this.refreshConcurrency();
    let gatewayPromise: ReturnType<typeof createConfiguredProviderGateway> | undefined;
    const getGateway = () => {
      gatewayPromise ??= createConfiguredProviderGateway();
      return gatewayPromise;
    };
    const workerSessionId = crypto.randomUUID();
    const lanes = Array.from(
      { length: DEFAULT_MAX_CONCURRENT_AGENT_RUNS },
      (_, laneIndex) => this.runLane(runtime, laneIndex, workerSessionId, getGateway, signal)
    );
    try {
      await Promise.all(lanes);
    } catch (error) {
      controller.abort(error);
      await Promise.allSettled(lanes);
      throw error;
    }
  }

  private async runLane(
    runtime: TutorDatabaseRuntime,
    laneIndex: number,
    workerSessionId: string,
    getGateway: () => ReturnType<typeof createConfiguredProviderGateway>,
    signal: AbortSignal
  ): Promise<void> {
    const workerId = `agent-worker:${workerSessionId}:${laneIndex + 1}`;
    let schedulingCycle = 0;
    while (true) {
      signal.throwIfAborted();
      await tutorDatabaseLifecycleCoordinator.waitUntilReady();
      const activeLimit = this.concurrency.activeLimit;
      if (laneIndex >= activeLimit) {
        await delay(WORKER_POLL_INTERVAL_MS, signal);
        continue;
      }
      const workPools = agentWorkPoolsForLane(laneIndex, activeLimit, schedulingCycle);
      const executionClasses = agentExecutionClassesForLane(laneIndex, activeLimit);
      schedulingCycle += 1;
      const now = Date.now() as Parameters<typeof runtime.agentRunRepository.nextWorkAt>[0];
      const nextWorkAt = await runtime.agentRunRepository.nextWorkAt(now, workPools, executionClasses);
      if (nextWorkAt === undefined) {
        await delay(WORKER_POLL_INTERVAL_MS, signal);
        continue;
      }
      if (nextWorkAt > now) {
        await delay(Math.min(WORKER_POLL_INTERVAL_MS, nextWorkAt - now), signal);
        continue;
      }
      const batch = await runtime.runTutorAgentBatch.execute({
        workerId,
        gateway: await getGateway(),
        maxConcurrent: 1,
        leaseMs: WORKER_LEASE_MS,
        workPools,
        executionClasses,
        signal
      });
      if (batch.retried > 0) {
        this.concurrency.recordRetry();
      } else if (batch.completed > 0) {
        this.concurrency.recordSuccess(batch.completed);
      }
      if (batch.claimed === 0 && batch.recovered === 0) {
        await delay(WORKER_POLL_INTERVAL_MS, signal);
      } else if (batch.retried > 0) {
        await delay(WORKER_POLL_INTERVAL_MS * 2, signal);
      }
    }
  }

  private async refreshConcurrency(): Promise<void> {
    const config = await aiConfigService.load();
    this.concurrency.configure(config.maxConcurrentTasks);
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export const agentWorkerCoordinator = new AgentWorkerCoordinator();
