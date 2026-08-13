import type { TransactionContext } from '@/capabilities/database/public';
import type {
  CapabilityNodeId,
  ExamCycleId,
  InstantMs,
  JsonObject,
  QuestionId,
  QuestionImportCandidateId,
  QuestionImportDraftId,
  QuestionImportPublishReceiptId,
  QuestionSetId,
  QuestionSourceId
} from '@/kernel/public';
import type { QuestionContent } from './QuestionContent';
import type {
  QuestionImportCandidateStatus,
  QuestionImportDraftStatus,
  QuestionImportIssueCode
} from '../domain/QuestionImportCodes';
import type {
  QuestionImportMethod,
  QuestionOriginType
} from '../domain/QuestionSourceCodes';

export interface QuestionImportIssue {
  readonly code: QuestionImportIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface QuestionImportSourceMetadata {
  readonly provider?: string;
  readonly examType?: string;
  readonly examYear?: number;
  readonly province?: string;
  readonly examBatch?: string;
  readonly paperName?: string;
  readonly sectionName?: string;
  readonly sourceVersion: string;
  readonly provenance: JsonObject;
}

export interface QuestionImportCandidateRecord {
  readonly id: QuestionImportCandidateId;
  readonly draftId: QuestionImportDraftId;
  readonly sequence: number;
  readonly raw: JsonObject;
  readonly content?: QuestionContent;
  readonly contentHash?: string;
  readonly difficulty: number;
  readonly status: QuestionImportCandidateStatus;
  readonly issues: readonly QuestionImportIssue[];
  readonly publishedQuestionId?: QuestionId;
  readonly createdAt: InstantMs;
  readonly updatedAt: InstantMs;
}

export interface QuestionImportDraftRecord {
  readonly id: QuestionImportDraftId;
  readonly examCycleId: ExamCycleId;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly capabilityCode: string;
  readonly module: string;
  readonly ownerSessionId?: string;
  readonly sourceType: QuestionOriginType;
  readonly importMethod: QuestionImportMethod;
  readonly sourceMetadata: QuestionImportSourceMetadata;
  readonly rawPayloadHash: string;
  readonly status: QuestionImportDraftStatus;
  readonly issues: readonly QuestionImportIssue[];
  readonly idempotencyKey: string;
  readonly publishedQuestionSetId?: QuestionSetId;
  readonly version: number;
  readonly createdAt: InstantMs;
  readonly updatedAt: InstantMs;
}

export interface QuestionImportDraftAggregate {
  readonly draft: QuestionImportDraftRecord;
  readonly candidates: readonly QuestionImportCandidateRecord[];
}

export interface QuestionImportPublishReceipt {
  readonly id: QuestionImportPublishReceiptId;
  readonly draftId: QuestionImportDraftId;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly questionSetId: QuestionSetId;
  readonly sourceId: QuestionSourceId;
  readonly publishedQuestionCount: number;
  readonly createdAt: InstantMs;
}

export interface QuestionImportDraftRepository {
  find(draftId: QuestionImportDraftId): Promise<QuestionImportDraftAggregate | undefined>;
  findByIdempotencyKey(idempotencyKey: string): Promise<QuestionImportDraftAggregate | undefined>;
  findLatestPendingByOwner(ownerSessionId: string): Promise<QuestionImportDraftAggregate | undefined>;
  findPublishReceipt(idempotencyKey: string): Promise<QuestionImportPublishReceipt | undefined>;
  save(aggregate: QuestionImportDraftAggregate, context: TransactionContext): Promise<void>;
  replace(aggregate: QuestionImportDraftAggregate, expectedVersion: number, context: TransactionContext): Promise<void>;
  markPublished(
    draftId: QuestionImportDraftId,
    expectedVersion: number,
    questionSetId: QuestionSetId,
    candidateQuestionIds: Readonly<Record<string, QuestionId>>,
    receipt: QuestionImportPublishReceipt,
    updatedAt: InstantMs,
    context: TransactionContext
  ): Promise<void>;
}
