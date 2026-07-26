import { appLifecycleAdapter } from '@/platform/AppLifecycleAdapter';
import { AI_CONFIG_CHANGED_EVENT, aiConfigService } from '@/services/AIConfigService';
import {
  AdaptiveAgentConcurrency,
  agentWorkPoolsForLane,
  DEFAULT_MAX_CONCURRENT_AGENT_RUNS,
} from '@/modules/agent/public';
import type { TutorDatabaseRuntime } from '../database/createTutorDatabaseRuntime';
import { tutorDatabaseLifecycleCoordinator } from '../database/TutorDatabaseLifecycleCoordinator';
import {
  createConfiguredProviderGateway,
  ProviderConfigurationError
} from '../ai/createConfiguredProviderGateway';

const WORKER_POLL_INTERVAL_MS = 1_000;
const WORKER_LEASE_MS = 60_000;

/**
 * Owns the single local Agent worker loop for both Web and native shells.
 * Re-entering the app only wakes this coordinator; it never creates a second runner.
 */
export class AgentWorkerCoordinator {
  private runtime?: TutorDatabaseRuntime;
  private worker?: Promise<void>;
  private removeActiveListener?: () => void;
  private wakeRequested = false;
  private providerConfigurationPaused = false;
  private configurationWarningReported = false;
  private configurationListenerInstalled = false;
  private concurrency = new AdaptiveAgentConcurrency(DEFAULT_MAX_CONCURRENT_AGENT_RUNS);

  install(runtime: TutorDatabaseRuntime): void {
    this.runtime = runtime;
    if (!this.removeActiveListener) {
      this.removeActiveListener = appLifecycleAdapter.onActive(() => {
        if (this.worker) {
          this.wakeRequested = true;
        } else {
          this.start();
        }
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
    if (!this.runtime || this.providerConfigurationPaused) return;
    if (this.worker) {
      this.wakeRequested = true;
      return;
    }
    this.worker = this.run(this.runtime)
      .catch((error: unknown) => {
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
        if (this.wakeRequested && !this.providerConfigurationPaused) {
          this.wakeRequested = false;
          globalThis.setTimeout(() => this.start(), 0);
        }
      });
  }

  private async run(runtime: TutorDatabaseRuntime): Promise<void> {
    await tutorDatabaseLifecycleCoordinator.waitUntilReady();
    await this.refreshConcurrency();
    let gatewayPromise: ReturnType<typeof createConfiguredProviderGateway> | undefined;
    const getGateway = () => {
      gatewayPromise ??= createConfiguredProviderGateway();
      return gatewayPromise;
    };
    const workerSessionId = crypto.randomUUID();
    await Promise.all(Array.from(
      { length: DEFAULT_MAX_CONCURRENT_AGENT_RUNS },
      (_, laneIndex) => this.runLane(runtime, laneIndex, workerSessionId, getGateway)
    ));
  }

  private async runLane(
    runtime: TutorDatabaseRuntime,
    laneIndex: number,
    workerSessionId: string,
    getGateway: () => ReturnType<typeof createConfiguredProviderGateway>
  ): Promise<void> {
    const workerId = `agent-worker:${workerSessionId}:${laneIndex + 1}`;
    let schedulingCycle = 0;
    while (true) {
      await tutorDatabaseLifecycleCoordinator.waitUntilReady();
      const activeLimit = this.concurrency.activeLimit;
      if (laneIndex >= activeLimit) {
        await delay(WORKER_POLL_INTERVAL_MS);
        continue;
      }
      const workPools = agentWorkPoolsForLane(laneIndex, activeLimit, schedulingCycle);
      schedulingCycle += 1;
      const now = Date.now() as Parameters<typeof runtime.agentRunRepository.nextWorkAt>[0];
      const nextWorkAt = await runtime.agentRunRepository.nextWorkAt(now, workPools);
      if (nextWorkAt === undefined) return;
      if (nextWorkAt > now) {
        await delay(Math.min(WORKER_POLL_INTERVAL_MS, nextWorkAt - now));
        continue;
      }
      const batch = await runtime.runTutorAgentBatch.execute({
        workerId,
        gateway: await getGateway(),
        maxConcurrent: 1,
        leaseMs: WORKER_LEASE_MS,
        workPools
      });
      if (batch.retried > 0) {
        this.concurrency.recordRetry();
      } else if (batch.completed > 0) {
        this.concurrency.recordSuccess(batch.completed);
      }
      if (batch.claimed === 0 && batch.recovered === 0) {
        await delay(WORKER_POLL_INTERVAL_MS);
      } else if (batch.retried > 0) {
        await delay(WORKER_POLL_INTERVAL_MS * 2);
      }
    }
  }

  private async refreshConcurrency(): Promise<void> {
    const config = await aiConfigService.load();
    this.concurrency.configure(config.maxConcurrentTasks);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export const agentWorkerCoordinator = new AgentWorkerCoordinator();
