import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId, InstantMs, JsonObject } from '@/kernel/public';
import type { LearningAssetKind, LearningAssetStatus } from '../domain/LearningAssetCodes';

export interface LearningAssetRecord {
  readonly id: string;
  readonly examCycleId: ExamCycleId;
  readonly kind: LearningAssetKind;
  readonly businessKey: string;
  readonly title: string;
  readonly status: LearningAssetStatus;
  readonly payload: JsonObject;
  readonly sourceAgentRunId?: string;
  readonly version: number;
  readonly createdAt: InstantMs;
  readonly updatedAt: InstantMs;
}

export interface LearningAssetQuery {
  readonly examCycleId: ExamCycleId;
  readonly kinds?: readonly LearningAssetKind[];
  readonly businessKey?: string;
  readonly status?: LearningAssetStatus;
  readonly limit: number;
}

export interface LearningAssetRepository {
  save(asset: LearningAssetRecord, context: TransactionContext): Promise<void>;
  saveDraft(asset: LearningAssetRecord, context: TransactionContext): Promise<void>;
  find(id: string): Promise<LearningAssetRecord | undefined>;
  findLatest(examCycleId: ExamCycleId, kind: LearningAssetKind, businessKey: string): Promise<LearningAssetRecord | undefined>;
  list(query: LearningAssetQuery): Promise<readonly LearningAssetRecord[]>;
  listAll(examCycleId: ExamCycleId): Promise<readonly LearningAssetRecord[]>;
  retire(id: string, updatedAt: InstantMs, context: TransactionContext): Promise<void>;
  retireBusinessKey(
    examCycleId: ExamCycleId,
    kind: LearningAssetKind,
    businessKey: string,
    updatedAt: InstantMs,
    context: TransactionContext
  ): Promise<void>;
}
