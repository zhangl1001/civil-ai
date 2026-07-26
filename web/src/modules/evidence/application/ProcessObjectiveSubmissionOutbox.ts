import type { Clock, LearningSessionId } from '@/kernel/public';
import type { OutboxEvent, OutboxRepository } from '@/modules/task/public';
import type { ObjectiveSubmissionPostProcessor } from './ObjectiveSubmissionPostProcessor';

const EVENT_TYPE = 'learning_session.objective_submitted';
const LEASE_MS = 30_000;

export interface ObjectiveSubmissionOutboxBatchResult {
  readonly claimed: number;
  readonly completed: number;
  readonly retried: number;
}

export class ProcessObjectiveSubmissionOutbox {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly processor: ObjectiveSubmissionPostProcessor,
    private readonly clock: Clock
  ) {}

  async execute(workerId: string, limit = 10): Promise<ObjectiveSubmissionOutboxBatchResult> {
    const now = this.clock.now();
    const events = await this.outbox.claimPending({
      workerId,
      now,
      leaseExpiresAt: (now + LEASE_MS) as typeof now,
      limit,
      eventTypes: [EVENT_TYPE]
    });
    let completed = 0;
    let retried = 0;
    for (const event of events) {
      const result = await this.process(event, workerId);
      if (result) completed += 1;
      else retried += 1;
    }
    return { claimed: events.length, completed, retried };
  }

  private async process(event: OutboxEvent, workerId: string): Promise<boolean> {
    try {
      const payload = parsePayload(event);
      const result = await this.processor.execute({
        idempotencyKey: event.idempotencyKey,
        sessionId: payload.sessionId as LearningSessionId,
        reviewQueueItemId: payload.reviewQueueItemId,
        dailyPlanItemId: payload.dailyPlanItemId,
        elapsedMs: payload.elapsedMs
      });
      if (result.pendingSteps.length) throw new Error(result.pendingSteps.join(','));
      return this.outbox.markPublished(event.id, workerId, this.clock.now());
    } catch (error) {
      const delay = Math.min(15 * 60_000, 2_000 * 2 ** Math.min(event.attemptCount, 8));
      await this.outbox.recordFailure(
        event.id,
        workerId,
        error instanceof Error ? error.message.slice(0, 160) : 'objective_post_processing_failed',
        (this.clock.now() + delay) as ReturnType<Clock['now']>
      );
      return false;
    }
  }
}

interface ParsedPayload {
  readonly sessionId: string;
  readonly reviewQueueItemId?: string;
  readonly dailyPlanItemId?: string;
  readonly elapsedMs: number;
}

function parsePayload(event: OutboxEvent): ParsedPayload {
  const sessionId = stringValue(event.payload.sessionId);
  if (!sessionId) throw new Error('Objective submission event is missing sessionId');
  return {
    sessionId,
    reviewQueueItemId: stringValue(event.payload.reviewQueueItemId),
    dailyPlanItemId: stringValue(event.payload.dailyPlanItemId),
    elapsedMs: numberValue(event.payload.elapsedMs)
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}
