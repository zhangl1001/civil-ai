import type { TransactionContext } from '@/capabilities/database/public';
import type {
  InstantMs,
  JsonObject,
  QuestionId,
  QuestionLineageId,
  QuestionSourceId,
  QuestionSourceImportReceiptId,
  QuestionSourceLinkId,
  WorkflowId
} from '@/kernel/public';
import type {
  QuestionCalibrationRole,
  QuestionDerivationType,
  QuestionImportMethod,
  QuestionOriginType,
  QuestionSourceRelationRole,
  QuestionSourceStatus
} from '../domain/QuestionSourceCodes';

export interface QuestionSourceRecord {
  readonly id: QuestionSourceId;
  readonly identityHash: string;
  readonly sourceType: QuestionOriginType;
  readonly provider?: string;
  readonly examType?: string;
  readonly examYear?: number;
  readonly province?: string;
  readonly examBatch?: string;
  readonly paperName?: string;
  readonly sectionName?: string;
  readonly provenance: JsonObject;
  readonly importMethod: QuestionImportMethod;
  readonly contentHash: string;
  readonly sourceVersion: string;
  readonly status: QuestionSourceStatus;
  readonly createdAt: InstantMs;
  readonly updatedAt: InstantMs;
}

export interface QuestionSourceLinkRecord {
  readonly id: QuestionSourceLinkId;
  readonly questionId: QuestionId;
  readonly sourceId: QuestionSourceId;
  readonly sourceSequence?: number;
  readonly materialGroupKey?: string;
  readonly relationRole: QuestionSourceRelationRole;
  readonly calibrationRole: QuestionCalibrationRole;
  readonly createdAt: InstantMs;
}

export interface QuestionLineageRecord {
  readonly id: QuestionLineageId;
  readonly questionId: QuestionId;
  readonly parentQuestionId: QuestionId;
  readonly derivationType: QuestionDerivationType;
  readonly generationWorkflowId?: WorkflowId;
  readonly referenceSnapshot: JsonObject;
  readonly createdAt: InstantMs;
}

export interface QuestionSourceImportReceipt {
  readonly id: QuestionSourceImportReceiptId;
  readonly idempotencyKey: string;
  readonly sourceId: QuestionSourceId;
  readonly payloadHash: string;
  readonly importedQuestionCount: number;
  readonly createdAt: InstantMs;
}

export interface QuestionSourceImportBundle {
  readonly source: QuestionSourceRecord;
  readonly links: readonly QuestionSourceLinkRecord[];
  readonly lineages: readonly QuestionLineageRecord[];
  readonly receipt: QuestionSourceImportReceipt;
}

export interface QuestionProvenanceView {
  readonly source?: QuestionSourceRecord;
  readonly links: readonly QuestionSourceLinkRecord[];
  readonly lineage?: QuestionLineageRecord;
}

export interface QuestionSourceRepository {
  findSource(sourceId: QuestionSourceId): Promise<QuestionSourceRecord | undefined>;
  findSourceByIdentityHash(identityHash: string): Promise<QuestionSourceRecord | undefined>;
  findSourceByContentHash(contentHash: string): Promise<QuestionSourceRecord | undefined>;
  findImportReceipt(idempotencyKey: string): Promise<QuestionSourceImportReceipt | undefined>;
  findQuestionProvenance(questionId: QuestionId): Promise<QuestionProvenanceView>;
  listSourceLinks(sourceId: QuestionSourceId, limit: number): Promise<readonly QuestionSourceLinkRecord[]>;
  saveImport(bundle: QuestionSourceImportBundle, context: TransactionContext): Promise<void>;
  saveLineages(lineages: readonly QuestionLineageRecord[], context: TransactionContext): Promise<void>;
  saveImportReceipt(receipt: QuestionSourceImportReceipt, context: TransactionContext): Promise<void>;
  archiveSource(sourceId: QuestionSourceId, updatedAt: InstantMs, context: TransactionContext): Promise<void>;
}
