import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, CapabilityNodeId, ExamCycleId, IdGenerator, JsonObject } from '@/kernel/public';
import type { CandidateRepository } from '@/modules/candidate/public';
import type { CurriculumRepository } from '@/modules/curriculum/public';
import type { OutboxRepository } from '@/modules/task/public';
import type { LearningThreadAggregate, LearningThreadRepository } from '../contracts/LearningThreadRepository';
import { LearningThreadEventType, LearningThreadStatus, type LearningThreadOrigin } from '../domain/LearningThreadCodes';
import type { LearningThreadStage } from '../domain/LearningThreadStage';

export interface CreateLearningThreadCommand {
  readonly idempotencyKey: string;
  readonly examCycleId: ExamCycleId;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly originType: LearningThreadOrigin;
  readonly originRefId?: string;
  readonly goal: string;
  readonly gapSnapshot: JsonObject;
  readonly initialStage: LearningThreadStage;
  readonly exitCriteria: JsonObject;
  readonly nextAction?: JsonObject;
}

export class CreateLearningThread {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly threadRepository: LearningThreadRepository,
    private readonly candidateRepository: CandidateRepository,
    private readonly curriculumRepository: CurriculumRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: CreateLearningThreadCommand): Promise<LearningThreadAggregate> {
    this.assertCommand(command);
    const existing = await this.threadRepository.findOpen(command.examCycleId, command.capabilityNodeId);
    if (existing) return existing;
    const cycle = await this.candidateRepository.findCycle(command.examCycleId);
    if (!cycle) throw new Error(`Exam cycle does not exist: ${command.examCycleId}`);
    const curriculum = await this.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId);
    const capability = curriculum?.capabilityNodes.find((item) => item.id === command.capabilityNodeId && item.status === 'active');
    if (!capability) throw new Error(`Active capability does not exist in bound curriculum: ${command.capabilityNodeId}`);
    const now = this.clock.now();
    const thread = {
      id: this.ids.next('LearningThreadId'),
      examCycleId: command.examCycleId,
      primaryCapabilityNodeId: command.capabilityNodeId,
      originType: command.originType,
      originRefId: command.originRefId?.trim() || undefined,
      goal: command.goal.trim(),
      gapSnapshot: command.gapSnapshot,
      stage: command.initialStage,
      status: LearningThreadStatus.Active,
      exitCriteria: command.exitCriteria,
      nextAction: command.nextAction,
      startedAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    const event = {
      id: this.ids.next('LearningThreadEventId'),
      learningThreadId: thread.id,
      examCycleId: thread.examCycleId,
      eventType: LearningThreadEventType.Created,
      toStage: thread.stage,
      reasonCode: `thread.origin.${thread.originType}`,
      payload: { originRefId: thread.originRefId ?? null, goal: thread.goal },
      occurredAt: now,
      idempotencyKey: `${command.idempotencyKey}:created`
    };
    const aggregate = { thread, events: [event] };
    try {
      await this.unitOfWork.run(async (context) => {
        await this.threadRepository.create(thread, event, context);
        await this.outboxRepository.append({
          id: this.ids.next('OutboxEventId'),
          aggregateType: 'learning_thread',
          aggregateId: thread.id,
          eventType: 'learning_thread.created',
          payload: { learningThreadId: thread.id, examCycleId: thread.examCycleId, capabilityNodeId: thread.primaryCapabilityNodeId },
          occurredAt: now,
          attemptCount: 0,
          idempotencyKey: `${command.idempotencyKey}:outbox`
        }, context);
      });
      return aggregate;
    } catch (error) {
      const concurrent = await this.threadRepository.findOpen(command.examCycleId, command.capabilityNodeId);
      if (concurrent) return concurrent;
      throw error;
    }
  }

  private assertCommand(command: CreateLearningThreadCommand): void {
    if (!command.idempotencyKey.trim()) throw new Error('Learning thread idempotency key is required');
    if (!command.goal.trim() || command.goal.trim().length > 500) throw new Error('Learning thread goal must be 1 to 500 characters');
  }
}
