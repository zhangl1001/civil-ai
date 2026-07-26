import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb, TutorIndexedDbStore } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { CapabilityNodeId, ExamCycleId, LearningThreadId } from '@/kernel/public';
import type {
  LearningThreadAggregate,
  LearningThreadEventRecord,
  LearningThreadRecord,
  LearningThreadRepository
} from '../contracts/LearningThreadRepository';

interface StoredThreadAggregate extends LearningThreadAggregate {
  readonly threadId: string;
  readonly examCycleKey: string;
  readonly capabilityKey: string;
}

export class IndexedDbLearningThreadRepository implements LearningThreadRepository {
  constructor(private readonly database: TutorIndexedDb, private readonly transactionScope: IndexedDbTransactionScope) {}

  async create(
    thread: LearningThreadRecord,
    event: LearningThreadEventRecord,
    context: TransactionContext
  ): Promise<void> {
    const existing = await this.findOpen(thread.examCycleId, thread.primaryCapabilityNodeId);
    if (existing) throw new Error(`Open learning thread already exists: ${existing.thread.id}`);
    this.transactionScope.stage(context, {
      type: 'add', store: TutorIndexedDbStore.LearningThreadAggregates, value: stored(thread, [event])
    });
  }

  async restore(aggregate: LearningThreadAggregate, context: TransactionContext): Promise<void> {
    if (!aggregate.events.length) throw new Error('Restored learning thread must contain at least one event');
    this.transactionScope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.LearningThreadAggregates,
      value: stored(aggregate.thread, aggregate.events)
    });
  }

  async replace(
    thread: LearningThreadRecord,
    expectedVersion: number,
    event: LearningThreadEventRecord,
    context: TransactionContext
  ): Promise<void> {
    const current = await this.findById(thread.id);
    if (!current || current.thread.version !== expectedVersion || thread.version !== expectedVersion + 1) {
      throw new Error(`Learning thread version conflict: ${thread.id}`);
    }
    this.transactionScope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.LearningThreadAggregates,
      value: stored(thread, [...current.events, event])
    });
  }

  async findById(threadId: LearningThreadId): Promise<LearningThreadAggregate | undefined> {
    const value = await this.database.get<StoredThreadAggregate>(TutorIndexedDbStore.LearningThreadAggregates, threadId);
    return value ? { thread: value.thread, events: value.events } : undefined;
  }

  async findOpen(examCycleId: ExamCycleId, capabilityNodeId: CapabilityNodeId): Promise<LearningThreadAggregate | undefined> {
    const values = await this.database.getAll<StoredThreadAggregate>(TutorIndexedDbStore.LearningThreadAggregates);
    const value = values
      .filter((item) => item.examCycleKey === examCycleId && item.capabilityKey === capabilityNodeId)
      .filter((item) => item.thread.status === 'active' || item.thread.status === 'paused')
      .sort((left, right) => right.thread.updatedAt - left.thread.updatedAt)[0];
    return value ? { thread: value.thread, events: value.events } : undefined;
  }

  async findEventByIdempotencyKey(idempotencyKey: string): Promise<LearningThreadEventRecord | undefined> {
    const values = await this.database.getAll<StoredThreadAggregate>(TutorIndexedDbStore.LearningThreadAggregates);
    return values.flatMap((item) => item.events).find((item) => item.idempotencyKey === idempotencyKey);
  }
}

function stored(thread: LearningThreadRecord, events: readonly LearningThreadEventRecord[]): StoredThreadAggregate {
  return {
    threadId: thread.id,
    examCycleKey: thread.examCycleId,
    capabilityKey: thread.primaryCapabilityNodeId,
    thread,
    events
  };
}
