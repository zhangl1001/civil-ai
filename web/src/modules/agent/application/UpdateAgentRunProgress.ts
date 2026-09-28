import type { UnitOfWork } from '@/capabilities/database/public';
import type { AgentRunId, Clock, IdGenerator, JsonObject } from '@/kernel/public';
import type { OutboxRepository } from '@/modules/task/public';
import type { AgentRunAggregate, AgentRunLeaseToken, AgentRunRecord, AgentRunRepository } from '../contracts/AgentRunRepository';
import { AgentRunStatus } from '../domain/AgentRunCodes';
import type { TaskCenterStep } from '../domain/TaskCenterCodes';
import { writeAgentRun } from './AgentRunWrite';

export interface UpdateAgentRunProgressCommand {
  readonly agentRunId: AgentRunId;
  readonly step: TaskCenterStep;
  readonly progress: number;
  readonly message: string;
  readonly data?: JsonObject;
  readonly leaseToken?: AgentRunLeaseToken;
}

export class UpdateAgentRunProgress {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: AgentRunRepository,
    private readonly outbox: OutboxRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  /**
   * Progress writes race whenever one run works in parallel (a mock exam
   * generates several question sets at once), so each write re-reads the run
   * inside its own transaction instead of replacing a version read earlier.
   */
  execute(command: UpdateAgentRunProgressCommand): Promise<AgentRunAggregate> {
    const requested = Math.max(0, Math.min(99, Math.round(command.progress)));
    const message = command.message.trim();
    return writeAgentRun(this.unitOfWork, this.repository, command.agentRunId, async (aggregate, context) => {
      if (aggregate.run.status !== AgentRunStatus.Running) {
        throw new Error(`Agent run progress requires running status: ${aggregate.run.status}`);
      }
      const now = this.clock.now();
      const position = progressPosition(aggregate.run, command.step, requested);
      const run = {
        ...aggregate.run,
        checkpoint: {
          ...aggregate.run.checkpoint,
          ...(command.data ?? {}),
          step: position.step,
          progress: position.progress,
          progressAttempt: aggregate.run.attemptCount,
          message
        },
        updatedAt: now,
        version: aggregate.run.version + 1
      };
      const event = {
        id: this.ids.next('AgentRunEventId'),
        agentRunId: run.id,
        eventType: 'progressed' as const,
        fromStatus: run.status,
        toStatus: run.status,
        reasonCode: `task.progress.${position.step}`,
        payload: { progress: position.progress, message, ...(command.data ?? {}) },
        occurredAt: now,
        idempotencyKey: `agent-run:${run.id}:progress:${run.version}`
      };
      await this.repository.replace(
        run,
        aggregate.run.version,
        event,
        context,
        command.leaseToken ? { leaseToken: command.leaseToken, now } : undefined
      );
      await this.outbox.append({
        id: this.ids.next('OutboxEventId'),
        aggregateType: 'tutor_agent_run',
        aggregateId: run.id,
        eventType: 'tutor_agent_run.progressed',
        payload: { agentRunId: run.id, step: position.step, progress: position.progress, message },
        occurredAt: now,
        attemptCount: 0,
        idempotencyKey: `${event.idempotencyKey}:outbox`
      }, context);
      return { run, events: [...aggregate.events, event] };
    });
  }
}

/**
 * Within one attempt the reported progress is a high-water mark: a batch that
 * reports late may refresh the activity message and its data, but cannot move
 * the bar (or the stage it belongs to) backwards. A new attempt starts over.
 */
function progressPosition(
  run: AgentRunRecord,
  step: TaskCenterStep,
  requested: number
): { readonly step: string; readonly progress: number } {
  const checkpoint = run.checkpoint;
  const current = checkpoint.progressAttempt === run.attemptCount && typeof checkpoint.progress === 'number'
    ? checkpoint.progress
    : undefined;
  if (current === undefined || requested >= current) return { step, progress: requested };
  return { step: typeof checkpoint.step === 'string' ? checkpoint.step : step, progress: current };
}
