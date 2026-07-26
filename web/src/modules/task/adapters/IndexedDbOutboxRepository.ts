import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import {
  TutorIndexedDb,
  TutorIndexedDbStore,
  type IndexedDbWriteOperation
} from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { InstantMs, OutboxEventId } from '@/kernel/public';
import type { ClaimOutboxOptions, OutboxEvent, OutboxRepository } from '../contracts/OutboxRepository';

interface StoredOutboxEvent extends OutboxEvent {
  readonly publishedAt?: InstantMs;
  readonly nextAttemptAt?: InstantMs;
  readonly claimedBy?: string;
  readonly claimExpiresAt?: InstantMs;
  readonly lastErrorCode?: string;
}

export class IndexedDbOutboxRepository implements OutboxRepository {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly transactionScope: IndexedDbTransactionScope
  ) {}

  async append(event: OutboxEvent, context: TransactionContext): Promise<void> {
    this.transactionScope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.DomainOutbox,
      value: event satisfies StoredOutboxEvent
    });
  }

  claimPending(options: ClaimOutboxOptions): Promise<readonly OutboxEvent[]> {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
      return Promise.reject(new RangeError('Outbox claim limit must be an integer between 1 and 100'));
    }
    if (options.leaseExpiresAt <= options.now) {
      return Promise.reject(new RangeError('Outbox lease must expire after claim time'));
    }

    return this.database.mutateStore<StoredOutboxEvent, readonly OutboxEvent[]>(
      TutorIndexedDbStore.DomainOutbox,
      (values) => {
        const candidates = values
          .filter((event) => event.publishedAt === undefined)
          .filter((event) => !options.eventTypes?.length || options.eventTypes.includes(event.eventType))
          .filter((event) => event.nextAttemptAt === undefined || event.nextAttemptAt <= options.now)
          .filter((event) => event.claimedBy === undefined || (
            event.claimExpiresAt !== undefined && event.claimExpiresAt <= options.now
          ))
          .sort((left, right) => left.occurredAt - right.occurredAt)
          .slice(0, options.limit);
        const operations: IndexedDbWriteOperation[] = candidates.map((event) => ({
          type: 'put',
          store: TutorIndexedDbStore.DomainOutbox,
          value: { ...event, claimedBy: options.workerId, claimExpiresAt: options.leaseExpiresAt }
        }));
        return { operations, result: candidates };
      }
    );
  }

  markPublished(eventId: OutboxEventId, workerId: string, publishedAt: InstantMs): Promise<boolean> {
    return this.updateClaimed(eventId, workerId, (event) => ({
      ...event,
      publishedAt,
      claimedBy: undefined,
      claimExpiresAt: undefined,
      lastErrorCode: undefined
    }));
  }

  recordFailure(
    eventId: OutboxEventId,
    workerId: string,
    errorCode: string,
    nextAttemptAt: InstantMs
  ): Promise<boolean> {
    return this.updateClaimed(eventId, workerId, (event) => ({
      ...event,
      attemptCount: event.attemptCount + 1,
      nextAttemptAt,
      lastErrorCode: errorCode,
      claimedBy: undefined,
      claimExpiresAt: undefined
    }));
  }

  private updateClaimed(
    eventId: OutboxEventId,
    workerId: string,
    update: (event: StoredOutboxEvent) => StoredOutboxEvent
  ): Promise<boolean> {
    return this.database.mutateStore<StoredOutboxEvent, boolean>(TutorIndexedDbStore.DomainOutbox, (values) => {
      const event = values.find((candidate) => candidate.id === eventId && candidate.claimedBy === workerId);
      if (!event || event.publishedAt !== undefined) return { operations: [], result: false };
      return {
        operations: [{ type: 'put', store: TutorIndexedDbStore.DomainOutbox, value: update(event) }],
        result: true
      };
    });
  }
}
