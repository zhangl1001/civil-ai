import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId, InstantMs } from '@/kernel/public';
import type { LearningProgressStatus, LearningResourceType } from '../domain/LearningProgressCodes';

export interface LearningProgressRecord {
  readonly id: string;
  readonly examCycleId: ExamCycleId;
  readonly resourceType: LearningResourceType;
  readonly resourceKey: string;
  readonly assetId?: string;
  readonly capabilityNodeId?: string;
  readonly dailyPlanItemId?: string;
  readonly status: LearningProgressStatus;
  readonly startedAt: InstantMs;
  readonly completedAt?: InstantMs;
  readonly updatedAt: InstantMs;
}

export interface LearningProgressRepository {
  save(progress: LearningProgressRecord, context: TransactionContext): Promise<void>;
  find(examCycleId: ExamCycleId, resourceType: LearningResourceType, resourceKey: string): Promise<LearningProgressRecord | undefined>;
  listByCycle(examCycleId: ExamCycleId): Promise<readonly LearningProgressRecord[]>;
}
