import type { TransactionContext } from '@/capabilities/database/public';
import type { InstantMs, JsonObject, OutboxEventId } from '@/kernel/public';

export interface OutboxEvent {
  readonly id: OutboxEventId;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: JsonObject;
  readonly occurredAt: InstantMs;
  readonly attemptCount: number;
  readonly idempotencyKey: string;
}

export interface ClaimOutboxOptions {
  readonly workerId: string;
  readonly now: InstantMs;
  readonly leaseExpiresAt: InstantMs;
  readonly limit: number;
}

export interface OutboxRepository {
  append(event: OutboxEvent, context: TransactionContext): Promise<void>;
  claimPending(options: ClaimOutboxOptions): Promise<readonly OutboxEvent[]>;
  markPublished(
    eventId: OutboxEventId,
    workerId: string,
    publishedAt: InstantMs
  ): Promise<boolean>;
  recordFailure(
    eventId: OutboxEventId,
    workerId: string,
    errorCode: string,
    nextAttemptAt: InstantMs
  ): Promise<boolean>;
}
