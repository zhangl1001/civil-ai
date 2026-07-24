import type { TransactionContext } from '@/capabilities/database/public';
import type {
  CapabilityNodeId,
  ExamCycleId,
  InstantMs,
  JsonObject,
  LearningThreadEventId,
  LearningThreadId
} from '@/kernel/public';
import type { LearningThreadStage } from '../domain/LearningThreadStage';
import type {
  LearningThreadEventType,
  LearningThreadOrigin,
  LearningThreadStatus
} from '../domain/LearningThreadCodes';

export interface LearningThreadRecord {
  readonly id: LearningThreadId;
  readonly examCycleId: ExamCycleId;
  readonly primaryCapabilityNodeId: CapabilityNodeId;
  readonly originType: LearningThreadOrigin;
  readonly originRefId?: string;
  readonly goal: string;
  readonly gapSnapshot: JsonObject;
  readonly stage: LearningThreadStage;
  readonly status: LearningThreadStatus;
  readonly exitCriteria: JsonObject;
  readonly nextAction?: JsonObject;
  readonly startedAt: InstantMs;
  readonly pausedAt?: InstantMs;
  readonly completedAt?: InstantMs;
  readonly closedReason?: string;
  readonly version: number;
  readonly createdAt: InstantMs;
  readonly updatedAt: InstantMs;
}

export interface LearningThreadEventRecord {
  readonly id: LearningThreadEventId;
  readonly learningThreadId: LearningThreadId;
  readonly examCycleId: ExamCycleId;
  readonly eventType: LearningThreadEventType;
  readonly fromStage?: LearningThreadStage;
  readonly toStage?: LearningThreadStage;
  readonly reasonCode: string;
  readonly payload: JsonObject;
  readonly occurredAt: InstantMs;
  readonly idempotencyKey: string;
}

export interface LearningThreadAggregate {
  readonly thread: LearningThreadRecord;
  readonly events: readonly LearningThreadEventRecord[];
}

export interface LearningThreadRepository {
  create(thread: LearningThreadRecord, event: LearningThreadEventRecord, context: TransactionContext): Promise<void>;
  replace(
    thread: LearningThreadRecord,
    expectedVersion: number,
    event: LearningThreadEventRecord,
    context: TransactionContext
  ): Promise<void>;
  findById(threadId: LearningThreadId): Promise<LearningThreadAggregate | undefined>;
  findOpen(examCycleId: ExamCycleId, capabilityNodeId: CapabilityNodeId): Promise<LearningThreadAggregate | undefined>;
  findEventByIdempotencyKey(idempotencyKey: string): Promise<LearningThreadEventRecord | undefined>;
}
