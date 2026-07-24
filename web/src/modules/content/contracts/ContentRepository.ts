import type { TransactionContext } from '@/capabilities/database/public';
import type {
  CapabilityNodeId,
  ContentDocumentId,
  ContentSchemaVersionId,
  ExamCycleId,
  GenerationSpecId,
  InstantMs,
  JsonObject,
  LectureId,
  LearningThreadId,
  QuestionId,
  QuestionSetId,
  QuestionTemplateVersionId,
  PromptVersionId,
  TeachingBlueprintId,
  WorkflowId,
  AssessmentRole
} from '@/kernel/public';
import type { ContentDocument } from './ContentDocument';
import type { QuestionContent } from './QuestionContent';
import type {
  ContentAssetStatus,
  ContentDocumentType,
  GenerationWorkflowStatus,
  GenerationWorkflowStep,
  PublishedAssetStatus,
  QuestionQualityStatus,
  QuestionSetPurpose,
  QuestionSetStatus,
  QuestionTemplateCode
} from '../domain/ContentCodes';

export interface ContentSchemaVersion {
  readonly id: ContentSchemaVersionId;
  readonly schemaCode: string;
  readonly documentType: ContentDocumentType;
  readonly version: string;
  readonly schema: JsonObject;
  readonly contentHash: string;
  readonly status: PublishedAssetStatus;
  readonly createdAt: InstantMs;
}

export interface QuestionTemplateVersion {
  readonly id: QuestionTemplateVersionId;
  readonly templateCode: QuestionTemplateCode;
  readonly version: string;
  readonly rendererCode: string;
  readonly contentSchemaVersionId: ContentSchemaVersionId;
  readonly config: JsonObject;
  readonly contentHash: string;
  readonly status: PublishedAssetStatus;
  readonly createdAt: InstantMs;
}

export interface ContentMetadataBundle {
  readonly releaseId: string;
  readonly contentHash: string;
  readonly schemaVersions: readonly ContentSchemaVersion[];
  readonly questionTemplateVersions: readonly QuestionTemplateVersion[];
}

export interface GenerationSpecRecord {
  readonly id: GenerationSpecId;
  readonly examCycleId: ExamCycleId;
  readonly learningThreadId?: LearningThreadId;
  readonly teachingBlueprintId?: TeachingBlueprintId;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly contentKind: 'lecture' | 'question_set' | 'lecture_with_questions';
  readonly assessmentRole: AssessmentRole;
  readonly questionTemplateVersionId?: QuestionTemplateVersionId;
  readonly contentSchemaVersionId: ContentSchemaVersionId;
  readonly promptVersionId: PromptVersionId;
  readonly requestedCount?: number;
  readonly difficulty: JsonObject;
  readonly constraints: JsonObject;
  readonly contextSnapshot: JsonObject;
  readonly contentHash: string;
  readonly createdAt: InstantMs;
}

export interface GenerationWorkflowRecord {
  readonly id: WorkflowId;
  readonly examCycleId: ExamCycleId;
  readonly generationSpecId: GenerationSpecId;
  readonly workflowType: 'lecture' | 'question_set' | 'lecture_with_questions';
  readonly status: GenerationWorkflowStatus;
  readonly currentStep: GenerationWorkflowStep;
  readonly attemptCount: number;
  readonly stagedResult?: JsonObject;
  readonly validation: JsonObject;
  readonly errorCode?: string;
  readonly idempotencyKey: string;
  readonly startedAt: InstantMs;
  readonly completedAt?: InstantMs;
  readonly updatedAt: InstantMs;
  readonly version: number;
}

export interface ContentDocumentRecord {
  readonly id: ContentDocumentId;
  readonly examCycleId: ExamCycleId;
  readonly documentType: ContentDocumentType;
  readonly schemaVersionId: ContentSchemaVersionId;
  readonly title?: string;
  readonly content: ContentDocument;
  readonly contentHash: string;
  readonly status: ContentAssetStatus;
  readonly contentVersion: number;
  readonly supersedesDocumentId?: ContentDocumentId;
  readonly generatorWorkflowId?: WorkflowId;
  readonly createdAt: InstantMs;
}

export interface LectureRecord {
  readonly id: LectureId;
  readonly examCycleId: ExamCycleId;
  readonly learningThreadId?: LearningThreadId;
  readonly teachingBlueprintId?: TeachingBlueprintId;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly contentDocumentId: ContentDocumentId;
  readonly objective: string;
  readonly status: 'staged' | 'ready' | 'retired' | 'rejected';
  readonly version: number;
  readonly createdAt: InstantMs;
}

export interface QuestionSetRecord {
  readonly id: QuestionSetId;
  readonly examCycleId: ExamCycleId;
  readonly learningThreadId?: LearningThreadId;
  readonly teachingBlueprintId?: TeachingBlueprintId;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly generationSpecId: GenerationSpecId;
  readonly purpose: QuestionSetPurpose;
  readonly assessmentRole: AssessmentRole;
  readonly module: string;
  readonly status: QuestionSetStatus;
  readonly questionCount: number;
  readonly contentHash?: string;
  readonly contentVersion: number;
  readonly createdAt: InstantMs;
}

export interface QuestionRecord {
  readonly id: QuestionId;
  readonly questionSetId: QuestionSetId;
  readonly examCycleId: ExamCycleId;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly questionTemplateVersionId: QuestionTemplateVersionId;
  readonly sequence: number;
  readonly difficulty: number;
  readonly cognitiveLevel: string;
  readonly purpose: string;
  readonly assessmentRole: AssessmentRole;
  readonly variantGroupId?: string;
  readonly content: QuestionContent;
  readonly correctAnswer: JsonObject;
  readonly qualityStatus: QuestionQualityStatus;
  readonly contentHash: string;
  readonly contentSchemaVersionId: ContentSchemaVersionId;
  readonly contentVersion: number;
  readonly generatorWorkflowId: WorkflowId;
  readonly createdAt: InstantMs;
}

export interface QuestionCapabilityLink {
  readonly questionId: QuestionId;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly relationRole: 'primary' | 'prerequisite' | 'secondary' | 'transfer';
  readonly weight: number;
}

export interface CommittedQuestionSetBundle {
  readonly generationSpec: GenerationSpecRecord;
  readonly generationWorkflow: GenerationWorkflowRecord;
  readonly documents: readonly ContentDocumentRecord[];
  readonly lectures: readonly LectureRecord[];
  readonly questionSet: QuestionSetRecord;
  readonly lectureLinks: readonly {
    readonly lectureId: LectureId;
    readonly questionSetId: QuestionSetId;
    readonly relationRole: 'primary' | 'extension' | 'review';
  }[];
  readonly questions: readonly QuestionRecord[];
  readonly capabilityLinks: readonly QuestionCapabilityLink[];
}

export interface ContentRepository {
  installMetadata(bundle: ContentMetadataBundle, context: TransactionContext): Promise<void>;
  findMetadata(releaseId: string): Promise<ContentMetadataBundle | undefined>;
  findPublishedSchema(schemaCode: string): Promise<ContentSchemaVersion | undefined>;
  findPublishedQuestionTemplate(templateCode: QuestionTemplateCode): Promise<QuestionTemplateVersion | undefined>;
  commitQuestionSet(bundle: CommittedQuestionSetBundle, context: TransactionContext): Promise<void>;
  findQuestionSet(questionSetId: QuestionSetId): Promise<CommittedQuestionSetBundle | undefined>;
  findQuestionSetByGenerationSpec(
    generationSpecId: GenerationSpecId
  ): Promise<CommittedQuestionSetBundle | undefined>;
  listQuestionSets(examCycleId: ExamCycleId, limit: number): Promise<readonly CommittedQuestionSetBundle[]>;
}
