import { ProviderGatewayError, type ProviderGateway } from '@/capabilities/ai-runtime/public';
import type { Clock, JsonObject } from '@/kernel/public';
import type { AgentRunAggregate } from '../contracts/AgentRunRepository';
import { AgentRunAction, type AgentRunType, DEFAULT_MAX_CONCURRENT_AGENT_RUNS } from '../domain/AgentRunCodes';
import { ClaimAgentRuns } from './ClaimAgentRuns';
import { RecoverExpiredAgentRuns } from './RecoverExpiredAgentRuns';
import { TransitionAgentRun } from './TransitionAgentRun';

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

/** Bounded local worker. Business handlers are explicitly registered by the composition root. */
export class RunTutorAgentBatch {
  private readonly handlers = new Map<AgentRunType, TutorAgentHandler>();

  constructor(
    private readonly claim: ClaimAgentRuns,
    private readonly recover: RecoverExpiredAgentRuns,
    private readonly transition: TransitionAgentRun,
    private readonly clock: Clock,
    handlers: readonly TutorAgentHandler[]
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
    const claimed = await this.claim.execute({ workerId: command.workerId, leaseExpiresAt: (this.clock.now() + leaseMs) as ReturnType<Clock['now']>, limit: maxConcurrent });
    const outcomes = await Promise.all(claimed.map((run) => this.executeOne(run, command.gateway, command.signal)));
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
    if (signal?.aborted) {
      await this.cancel(run, 'agent_run.worker_aborted');
      return 'cancelled';
    }
    const handler = this.handlers.get(run.run.runType);
    if (!handler) {
      await this.fail(run, 'agent_run.handler_missing');
      return 'failed';
    }
    if (handler.requiresGateway && !gateway) {
      await this.fail(run, 'agent_run.gateway_missing');
      return 'failed';
    }
    try {
      await handler.execute(run, gateway, signal);
      return 'completed';
    } catch (error) {
      if (signal?.aborted) {
        await this.cancel(run, 'agent_run.worker_aborted');
        return 'cancelled';
      }
      const retryAfterMs = retryDelay(error, run.run.attemptCount);
      if (retryAfterMs !== undefined && run.run.attemptCount < 4) {
        await this.transition.execute({
          idempotencyKey: `agent-run:${run.run.id}:retry:${run.run.attemptCount}`,
          agentRunId: run.run.id, action: AgentRunAction.Retry, reasonCode: 'agent_run.transient_failure',
          errorCode: errorCode(error), nextRunAt: (this.clock.now() + retryAfterMs) as ReturnType<Clock['now']>,
          payload: { retryAfterMs, errorCode: errorCode(error) } as JsonObject
        });
        return 'retried';
      }
      await this.fail(run, errorCode(error));
      return 'failed';
    }
  }

  private fail(run: AgentRunAggregate, code: string): Promise<unknown> {
    return this.transition.execute({ idempotencyKey: `agent-run:${run.run.id}:failed:${run.run.attemptCount}`, agentRunId: run.run.id, action: AgentRunAction.Fail, reasonCode: 'agent_run.execution_failed', errorCode: code });
  }

  private cancel(run: AgentRunAggregate, reason: string): Promise<unknown> {
    return this.transition.execute({ idempotencyKey: `agent-run:${run.run.id}:cancelled:${run.run.attemptCount}`, agentRunId: run.run.id, action: AgentRunAction.Cancel, reasonCode: reason, cancellationReason: reason });
  }
}

function retryDelay(error: unknown, attemptCount: number): number | undefined {
  if (!(error instanceof ProviderGatewayError)) return undefined;
  if (error.kind !== 'rate_limited' && error.kind !== 'transient' && error.kind !== 'empty_response') return undefined;
  return error.retryAfterMs ?? Math.min(120_000, 1_000 * 2 ** Math.max(0, attemptCount - 1));
}

function errorCode(error: unknown): string {
  if (error instanceof ProviderGatewayError) return `provider.${error.kind}`;
  return error instanceof Error && error.name ? `agent.${error.name}` : 'agent.unknown_error';
}
