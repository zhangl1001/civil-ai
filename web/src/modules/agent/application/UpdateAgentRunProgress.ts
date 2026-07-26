import type { UnitOfWork } from '@/capabilities/database/public';
import type { AgentRunId, Clock, IdGenerator, JsonObject } from '@/kernel/public';
import type { OutboxRepository } from '@/modules/task/public';
import type { AgentRunAggregate, AgentRunRepository } from '../contracts/AgentRunRepository';
import { AgentRunStatus } from '../domain/AgentRunCodes';
import type { TaskCenterStep } from '../domain/TaskCenterCodes';

export interface UpdateAgentRunProgressCommand {
  readonly agentRunId: AgentRunId;
  readonly step: TaskCenterStep;
  readonly progress: number;
  readonly message: string;
  readonly data?: JsonObject;
}

export class UpdateAgentRunProgress {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: AgentRunRepository,
    private readonly outbox: OutboxRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: UpdateAgentRunProgressCommand): Promise<AgentRunAggregate> {
    const aggregate = await this.repository.findById(command.agentRunId);
    if (!aggregate) throw new Error(`Agent run does not exist: ${command.agentRunId}`);
    if (aggregate.run.status !== AgentRunStatus.Running) {
      throw new Error(`Agent run progress requires running status: ${aggregate.run.status}`);
    }
    const progress = Math.max(0, Math.min(99, Math.round(command.progress)));
    const now = this.clock.now();
    const run = {
      ...aggregate.run,
      checkpoint: {
        ...aggregate.run.checkpoint,
        step: command.step,
        progress,
        message: command.message.trim(),
        ...(command.data ?? {})
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
      reasonCode: `task.progress.${command.step}`,
      payload: { progress, message: command.message.trim(), ...(command.data ?? {}) },
      occurredAt: now,
      idempotencyKey: `agent-run:${run.id}:progress:${run.version}`
    };
    await this.unitOfWork.run(async (context) => {
      await this.repository.replace(run, aggregate.run.version, event, context);
      await this.outbox.append({
        id: this.ids.next('OutboxEventId'),
        aggregateType: 'tutor_agent_run',
        aggregateId: run.id,
        eventType: 'tutor_agent_run.progressed',
        payload: { agentRunId: run.id, step: command.step, progress, message: command.message.trim() },
        occurredAt: now,
        attemptCount: 0,
        idempotencyKey: `${event.idempotencyKey}:outbox`
      }, context);
    });
    return { run, events: [...aggregate.events, event] };
  }
}
