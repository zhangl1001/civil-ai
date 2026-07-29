import { ProviderGatewayError, type ProviderGateway } from '@/capabilities/ai-runtime/public';
import type { Clock, JsonObject } from '@/kernel/public';
import type { AgentRunAggregate } from '../contracts/AgentRunRepository';
import {
  AgentRunAction,
  type AgentExecutionClass,
  type AgentRunType,
  type AgentWorkPool,
  DEFAULT_MAX_CONCURRENT_AGENT_RUNS
} from '../domain/AgentRunCodes';
import { ClaimAgentRuns } from './ClaimAgentRuns';
import { RecoverExpiredAgentRuns } from './RecoverExpiredAgentRuns';
import { TransitionAgentRun } from './TransitionAgentRun';
import { AgentRunExecutionRegistry } from './AgentRunExecutionRegistry';

export interface TutorAgentHandler {
  readonly runType: AgentRunType;
  readonly requiresGateway?: boolean;
  execute(run: AgentRunAggregate, gateway: ProviderGateway | undefined, signal?: AbortSignal): Promise<void>;
}

export interface RunTutorAgentBatchCommand {
  readonly workerId: string;
  readonly gateway?: ProviderGateway;
  readonly leaseMs?: number;
  readonly maxConcurrent?: number;
  readonly workPools?: readonly AgentWorkPool[];
  readonly executionClasses?: readonly AgentExecutionClass[];
  readonly signal?: AbortSignal;
}

export interface TutorAgentBatchResult {
  readonly recovered: number;
  readonly claimed: number;
  readonly completed: number;
  readonly retried: number;
  readonly failed: number;
  readonly cancelled: number;
}

export interface TutorAgentLifecycleObserver {
  completed(run: AgentRunAggregate): Promise<void>;
  retrying(run: AgentRunAggregate, errorCode: string): Promise<void>;
  failed(run: AgentRunAggregate, errorCode: string): Promise<void>;
  cancelled(run: AgentRunAggregate, reason: string): Promise<void>;
}

/** Bounded local worker. Business handlers are explicitly registered by the composition root. */
export class RunTutorAgentBatch {
  private readonly handlers = new Map<AgentRunType, TutorAgentHandler>();

  constructor(
    private readonly claim: ClaimAgentRuns,
    private readonly recover: RecoverExpiredAgentRuns,
    private readonly transition: TransitionAgentRun,
    private readonly clock: Clock,
    handlers: readonly TutorAgentHandler[],
    private readonly executions?: AgentRunExecutionRegistry,
    private readonly lifecycle?: TutorAgentLifecycleObserver
  ) {
    handlers.forEach((handler) => this.handlers.set(handler.runType, handler));
  }

  async execute(command: RunTutorAgentBatchCommand): Promise<TutorAgentBatchResult> {
    const maxConcurrent = command.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_AGENT_RUNS;
    const leaseMs = command.leaseMs ?? 90_000;
    if (!command.workerId.trim() || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > DEFAULT_MAX_CONCURRENT_AGENT_RUNS || !Number.isInteger(leaseMs) || leaseMs < 10_000) {
      throw new Error('Invalid tutor agent worker command');
    }
    const recovered = await this.recover.execute(maxConcurrent);
    const claimed = await this.claim.execute({
      workerId: command.workerId,
      leaseExpiresAt: (this.clock.now() + leaseMs) as ReturnType<Clock['now']>,
      limit: maxConcurrent,
      workPools: command.workPools,
      executionClasses: command.executionClasses
    });
    const heartbeat = claimed.length
      ? globalThis.setInterval(() => {
        void this.claim.renew(claimed.map((run) => run.run.id), command.workerId, leaseMs).catch(() => undefined);
      }, Math.max(5_000, Math.floor(leaseMs / 3)))
      : undefined;
    let outcomes: Array<'completed' | 'retried' | 'failed' | 'cancelled'>;
    try {
      outcomes = await Promise.all(claimed.map((run) => this.executeOne(run, command.gateway, command.signal)));
    } finally {
      if (heartbeat !== undefined) globalThis.clearInterval(heartbeat);
    }
    return {
      recovered: recovered.length, claimed: claimed.length,
      completed: outcomes.filter((item) => item === 'completed').length,
      retried: outcomes.filter((item) => item === 'retried').length,
      failed: outcomes.filter((item) => item === 'failed').length,
      cancelled: outcomes.filter((item) => item === 'cancelled').length
    };
  }

  async executeRuns(runs: readonly AgentRunAggregate[], gateway?: ProviderGateway, signal?: AbortSignal): Promise<TutorAgentBatchResult> {
    const outcomes = await Promise.all(runs.map((run) => this.executeOne(run, gateway, signal)));
    return {
      recovered: 0,
      claimed: runs.length,
      completed: outcomes.filter((item) => item === 'completed').length,
      retried: outcomes.filter((item) => item === 'retried').length,
      failed: outcomes.filter((item) => item === 'failed').length,
      cancelled: outcomes.filter((item) => item === 'cancelled').length
    };
  }

  private async executeOne(run: AgentRunAggregate, gateway: ProviderGateway | undefined, signal?: AbortSignal): Promise<'completed' | 'retried' | 'failed' | 'cancelled'> {
    const handler = this.handlers.get(run.run.runType);
    if (!handler) {
      await this.fail(run, 'agent_run.handler_missing');
      await this.notify(() => this.lifecycle?.failed(run, 'agent_run.handler_missing'));
      return 'failed';
    }
    if (handler.requiresGateway && !gateway) {
      await this.fail(run, 'agent_run.gateway_missing');
      await this.notify(() => this.lifecycle?.failed(run, 'agent_run.gateway_missing'));
      return 'failed';
    }
    const executionSignal = this.executions?.begin(run.run.id, signal) ?? signal;
    try {
      if (executionSignal?.aborted) {
        await this.cancel(run, 'agent_run.worker_aborted');
        await this.notify(() => this.lifecycle?.cancelled(run, 'agent_run.worker_aborted'));
        return 'cancelled';
      }
      await handler.execute(run, gateway, executionSignal);
      await this.notify(() => this.lifecycle?.completed(run));
      return 'completed';
    } catch (error) {
      if (import.meta.env.DEV && typeof window !== 'undefined') {
        console.warn('[RunTutorAgentBatch] execution failed', JSON.stringify({
          agentRunId: run.run.id,
          runType: run.run.runType,
          targetResourceType: run.run.targetResourceType,
          ...errorDiagnostics(error)
        }));
      }
      if (executionSignal?.aborted) {
        await this.cancel(run, 'agent_run.worker_aborted');
        await this.notify(() => this.lifecycle?.cancelled(run, 'agent_run.worker_aborted'));
        return 'cancelled';
      }
      const retryAfterMs = retryDelay(error, run.run.attemptCount);
      if (retryAfterMs !== undefined && run.run.attemptCount < 4) {
        const code = errorCode(error);
        await this.transition.execute({
          idempotencyKey: `agent-run:${run.run.id}:retry:${run.run.attemptCount}`,
          agentRunId: run.run.id, action: AgentRunAction.Retry, reasonCode: 'agent_run.transient_failure',
          errorCode: code, nextRunAt: (this.clock.now() + retryAfterMs) as ReturnType<Clock['now']>,
          payload: { retryAfterMs, errorCode: code } as JsonObject
        });
        await this.notify(() => this.lifecycle?.retrying(run, code));
        return 'retried';
      }
      const code = errorCode(error);
      await this.fail(run, code, error);
      await this.notify(() => this.lifecycle?.failed(run, code));
      return 'failed';
    } finally {
      this.executions?.finish(run.run.id);
    }
  }

  private async fail(run: AgentRunAggregate, code: string, error?: unknown): Promise<void> {
    try {
      const diagnostics = errorDiagnostics(error);
      const message = readableErrorMessage(error);
      await this.transition.execute({
        idempotencyKey: `agent-run:${run.run.id}:failed:${run.run.attemptCount}`,
        agentRunId: run.run.id,
        action: AgentRunAction.Fail,
        reasonCode: 'agent_run.execution_failed',
        errorCode: code,
        checkpoint: {
          ...run.run.checkpoint,
          errorCode: code,
          errorMessage: message,
          message,
          ...(run.run.inputSnapshot.notifyOnTerminal === true
            ? { taskCenterVisible: true }
            : {})
        },
        payload: diagnostics
      });
    } catch (error) {
      if (!isTerminalTransitionConflict(error)) throw error;
    }
  }

  private async cancel(run: AgentRunAggregate, reason: string): Promise<void> {
    try {
      await this.transition.execute({ idempotencyKey: `agent-run:${run.run.id}:cancelled:${run.run.attemptCount}`, agentRunId: run.run.id, action: AgentRunAction.Cancel, reasonCode: reason, cancellationReason: reason });
    } catch (error) {
      if (!isTerminalTransitionConflict(error)) throw error;
    }
  }

  private async notify(callback: () => Promise<void> | undefined): Promise<void> {
    try {
      await callback();
    } catch {
      // Message projection is secondary and must never change the task outcome.
    }
  }
}

function retryDelay(error: unknown, attemptCount: number): number | undefined {
  const code = codedError(error);
  if (code === 'content.enrichment_incomplete' || code === 'content.enrichment_invalid') {
    return Math.min(60_000, 2_000 * 2 ** Math.max(0, attemptCount - 1));
  }
  if (code === 'generation.process_interrupted') {
    return attemptCount < 2 ? 500 : undefined;
  }
  if (isUnexpectedAbort(error)) {
    return Math.min(30_000, 1_000 * 2 ** Math.max(0, attemptCount - 1));
  }
  if (!(error instanceof ProviderGatewayError)) return undefined;
  if (error.kind !== 'rate_limited' && error.kind !== 'transient' && error.kind !== 'empty_response') return undefined;
  return error.retryAfterMs ?? Math.min(120_000, 1_000 * 2 ** Math.max(0, attemptCount - 1));
}

function errorCode(error: unknown): string {
  if (error instanceof ProviderGatewayError) return `provider.${error.kind}`;
  if (isUnexpectedAbort(error)) return 'provider.transient';
  const code = codedError(error);
  if (code) return code;
  return error instanceof Error && error.name ? `agent.${error.name}` : 'agent.unknown_error';
}

function isUnexpectedAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function codedError(error: unknown): string | undefined {
  return error
    && typeof error === 'object'
    && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
}

function errorDiagnostics(error: unknown): JsonObject {
  if (!error || typeof error !== 'object') return {};
  const details = error as {
    readonly message?: unknown;
    readonly issues?: unknown;
  };
  const issues: JsonObject[] = Array.isArray(details.issues)
    ? details.issues.slice(0, 12).map((item) => {
      if (!item || typeof item !== 'object') return {
        code: 'unknown',
        path: '$',
        message: String(item)
      };
      const issue = item as Record<string, unknown>;
      return {
        code: typeof issue.code === 'string' ? issue.code : 'unknown',
        path: typeof issue.path === 'string' ? issue.path : '$',
        message: typeof issue.message === 'string' ? issue.message : 'Validation failed'
      };
    })
    : [];
  return {
    message: typeof details.message === 'string' ? details.message.slice(0, 240) : 'Agent execution failed',
    issues
  };
}

function readableErrorMessage(error: unknown): string {
  if (error instanceof ProviderGatewayError) return error.message.slice(0, 240);
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 240);
  if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 240);
  return 'Agent 执行失败，未返回具体错误信息';
}

function isTerminalTransitionConflict(error: unknown): boolean {
  return error instanceof Error && /transition is not allowed/.test(error.message);
}
