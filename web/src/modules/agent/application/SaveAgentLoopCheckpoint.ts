import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, IdGenerator, JsonObject } from '@/kernel/public';
import type { AgentRunLeaseToken, AgentRunRepository } from '../contracts/AgentRunRepository';
import type { AgentCheckpointStore, AgentLoopCheckpoint } from '../contracts/AgentRuntimePorts';
import { AgentRunStatus } from '../domain/AgentRunCodes';

/** Persists private working memory without publishing the full context through Outbox. */
export class SaveAgentLoopCheckpoint implements AgentCheckpointStore {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: AgentRunRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async save(checkpoint: AgentLoopCheckpoint, leaseToken?: AgentRunLeaseToken): Promise<void> {
    const aggregate = await this.repository.findById(checkpoint.agentRunId);
    if (!aggregate) throw new Error(`Agent run does not exist: ${checkpoint.agentRunId}`);
    if (aggregate.run.status !== AgentRunStatus.Running) {
      throw new Error(`Agent checkpoint requires running status: ${aggregate.run.status}`);
    }
    const now = this.clock.now();
    const run = {
      ...aggregate.run,
      checkpoint: {
        ...aggregate.run.checkpoint,
        agentLoop: toJson(checkpoint)
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
      reasonCode: 'agent_run.checkpoint_saved',
      payload: {
        turnCount: checkpoint.turnCount,
        toolCallCount: checkpoint.toolCallCount,
        waitingConfirmation: Boolean(checkpoint.pendingConfirmation)
      },
      occurredAt: now,
      idempotencyKey: `agent-run:${run.id}:checkpoint:${run.version}`
    };
    await this.unitOfWork.run((context) => (
      this.repository.replace(
        run,
        aggregate.run.version,
        event,
        context,
        leaseToken ? { leaseToken, now } : undefined
      )
    ));
  }
}

function toJson(value: unknown): JsonObject {
  const serialized = JSON.parse(JSON.stringify(value)) as unknown;
  if (!serialized || typeof serialized !== 'object' || Array.isArray(serialized)) {
    throw new TypeError('Agent checkpoint must serialize to an object');
  }
  return serialized as JsonObject;
}
