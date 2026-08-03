import type { UnitOfWork } from '@/capabilities/database/public';
import type { AgentRunId, Clock, ExamCycleId, IdGenerator, InstantMs, JsonObject, LearningThreadId } from '@/kernel/public';
import type { OutboxRepository } from '@/modules/task/public';
import type { AgentRunAggregate, AgentRunRepository } from '../contracts/AgentRunRepository';
import {
  AgentRunStatus,
  resolveAgentExecutionClass,
  resolveAgentWorkPool,
  type AgentRunType,
  type AgentWorkPool
} from '../domain/AgentRunCodes';

export interface CreateAgentRunCommand {
  readonly idempotencyKey: string;
  readonly runType: AgentRunType;
  readonly workPool?: AgentWorkPool;
  readonly rootAgentRunId?: AgentRunId;
  readonly parentAgentRunId?: AgentRunId;
  readonly examCycleId?: ExamCycleId;
  readonly learningThreadId?: LearningThreadId;
  readonly targetResourceType?: string;
  readonly targetResourceId?: string;
  readonly inputSnapshot: JsonObject;
  readonly nextRunAt?: InstantMs;
}

export class CreateAgentRun {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly repository: AgentRunRepository, private readonly outbox: OutboxRepository, private readonly clock: Clock, private readonly ids: IdGenerator) {}
  async execute(command: CreateAgentRunCommand): Promise<AgentRunAggregate> {
    if (!command.idempotencyKey.trim()) throw new Error('Agent run idempotency key is required');
    const existing = await this.repository.findByIdempotencyKey(command.idempotencyKey);
    if (existing) return existing;
    const parent = command.parentAgentRunId
      ? await this.repository.findById(command.parentAgentRunId)
      : undefined;
    if (command.parentAgentRunId && !parent) {
      throw new Error(`Parent agent run does not exist: ${command.parentAgentRunId}`);
    }
    const id = this.ids.next('AgentRunId');
    const inheritedRootId = parent?.run.rootAgentRunId ?? parent?.run.id;
    if (command.rootAgentRunId && inheritedRootId && command.rootAgentRunId !== inheritedRootId) {
      throw new Error('Agent run root does not match parent lineage');
    }
    const rootAgentRunId = command.rootAgentRunId ?? inheritedRootId ?? id;
    if (rootAgentRunId !== id && !parent) {
      const root = await this.repository.findById(rootAgentRunId);
      if (!root || (root.run.rootAgentRunId ?? root.run.id) !== rootAgentRunId) {
        throw new Error(`Root agent run does not exist: ${rootAgentRunId}`);
      }
    }
    const now = this.clock.now();
    const targetResourceType = command.targetResourceType?.trim() || undefined;
    const run = {
      id,
      rootAgentRunId,
      parentAgentRunId: command.parentAgentRunId,
      runType: command.runType,
      workPool: command.workPool ?? resolveAgentWorkPool(command.runType, targetResourceType, command.inputSnapshot),
      executionClass: resolveAgentExecutionClass(command.runType, targetResourceType, command.inputSnapshot),
      status: AgentRunStatus.Queued,
      examCycleId: command.examCycleId,
      learningThreadId: command.learningThreadId,
      targetResourceType,
      targetResourceId: command.targetResourceId?.trim() || undefined,
      inputSnapshot: command.inputSnapshot,
      checkpoint: {},
      attemptCount: 0,
      nextRunAt: command.nextRunAt,
      leaseEpoch: 0,
      idempotencyKey: command.idempotencyKey,
      createdAt: now,
      updatedAt: now,
      version: 1
    };
    const event = { id:this.ids.next('AgentRunEventId'), agentRunId:run.id, eventType:'created' as const, toStatus:run.status, reasonCode:`agent_run.${run.runType}.created`, payload:{}, occurredAt:now, idempotencyKey:`${command.idempotencyKey}:created` };
    try { await this.unitOfWork.run(async context => { await this.repository.create(run,event,context); await this.outbox.append({id:this.ids.next('OutboxEventId'),aggregateType:'tutor_agent_run',aggregateId:run.id,eventType:'tutor_agent_run.created',payload:{agentRunId:run.id,rootAgentRunId:run.rootAgentRunId,parentAgentRunId:run.parentAgentRunId??null,runType:run.runType,workPool:run.workPool,examCycleId:run.examCycleId??null},occurredAt:now,attemptCount:0,idempotencyKey:`${command.idempotencyKey}:outbox`},context); }); return {run,events:[event]}; }
    catch(error){ const concurrent=await this.repository.findByIdempotencyKey(command.idempotencyKey); if(concurrent)return concurrent; throw error; }
  }
}
