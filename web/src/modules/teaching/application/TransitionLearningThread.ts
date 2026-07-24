import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, IdGenerator, JsonObject, LearningThreadId } from '@/kernel/public';
import type { OutboxRepository } from '@/modules/task/public';
import type { LearningThreadAggregate, LearningThreadRepository } from '../contracts/LearningThreadRepository';
import { LearningThreadMachine } from '../domain/LearningThreadMachine';
import { LearningThreadEventType, type LearningThreadEventType as LearningThreadEventTypeCode } from '../domain/LearningThreadCodes';
import type { LearningThreadStage } from '../domain/LearningThreadStage';

export const LearningThreadAction = {
  Advance: 'advance',
  Pause: 'pause',
  Resume: 'resume',
  Complete: 'complete',
  Abandon: 'abandon'
} as const;
export type LearningThreadAction = typeof LearningThreadAction[keyof typeof LearningThreadAction];

export interface TransitionLearningThreadCommand {
  readonly idempotencyKey: string;
  readonly learningThreadId: LearningThreadId;
  readonly action: LearningThreadAction;
  readonly nextStage?: LearningThreadStage;
  readonly nextAction?: JsonObject;
  readonly reasonCode: string;
  readonly reasonDetail?: string;
  readonly payload?: JsonObject;
}

export class TransitionLearningThread {
  private readonly machine = new LearningThreadMachine();

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly threadRepository: LearningThreadRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: TransitionLearningThreadCommand): Promise<LearningThreadAggregate> {
    if (!command.idempotencyKey.trim() || !command.reasonCode.trim()) throw new Error('Learning thread transition requires idempotency key and reason code');
    const applied = await this.threadRepository.findEventByIdempotencyKey(command.idempotencyKey);
    if (applied) {
      const existing = await this.threadRepository.findById(applied.learningThreadId);
      if (existing) return existing;
    }
    const aggregate = await this.threadRepository.findById(command.learningThreadId);
    if (!aggregate) throw new Error(`Learning thread does not exist: ${command.learningThreadId}`);
    const now = this.clock.now();
    const transition = this.transition(aggregate, command, now);
    const event = {
      id: this.ids.next('LearningThreadEventId'),
      learningThreadId: transition.thread.id,
      examCycleId: transition.thread.examCycleId,
      eventType: transition.eventType,
      fromStage: transition.fromStage,
      toStage: transition.toStage,
      reasonCode: command.reasonCode.trim(),
      payload: command.payload ?? {},
      occurredAt: now,
      idempotencyKey: command.idempotencyKey
    };
    await this.unitOfWork.run(async (context) => {
      await this.threadRepository.replace(transition.thread, aggregate.thread.version, event, context);
      await this.outboxRepository.append({
        id: this.ids.next('OutboxEventId'),
        aggregateType: 'learning_thread',
        aggregateId: transition.thread.id,
        eventType: `learning_thread.${eventName(transition.eventType)}`,
        payload: { learningThreadId: transition.thread.id, action: command.action, stage: transition.thread.stage },
        occurredAt: now,
        attemptCount: 0,
        idempotencyKey: `${command.idempotencyKey}:outbox`
      }, context);
    });
    return { thread: transition.thread, events: [...aggregate.events, event] };
  }

  private transition(
    aggregate: LearningThreadAggregate,
    command: TransitionLearningThreadCommand,
    now: ReturnType<Clock['now']>
  ) {
    if (command.action === LearningThreadAction.Advance) {
      if (!command.nextStage) throw new Error('Learning thread advance requires a next stage');
      return this.machine.advance(aggregate.thread, command.nextStage, command.nextAction, now);
    }
    if (command.action === LearningThreadAction.Pause) return this.machine.pause(aggregate.thread, now);
    if (command.action === LearningThreadAction.Resume) return this.machine.resume(aggregate.thread, now);
    if (command.action === LearningThreadAction.Complete) return this.machine.complete(aggregate.thread, command.reasonDetail ?? command.reasonCode, now);
    return this.machine.abandon(aggregate.thread, command.reasonDetail ?? command.reasonCode, now);
  }
}

function eventName(type: LearningThreadEventTypeCode): string {
  return type === LearningThreadEventType.StageAdvanced ? 'stage_advanced' : type;
}
