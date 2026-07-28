export {
  CalloutKind,
  ContentAlignment,
  ContentBlockType,
  ContentDocumentType,
  QuestionTemplateCode,
  QuestionPresentationCode,
  QuestionRegionCode,
  QuestionRegionLayoutCode,
  ContentAssetStatus,
  PublishedAssetStatus,
  QuestionQualityStatus,
  QuestionSetEntryMode,
  GenerationSelectionAuthority,
  QuestionSetPurpose,
  QuestionSetPracticeStatus,
  QuestionSetStatus,
  GenerationWorkflowStatus,
  GenerationWorkflowStep,
  ContentCommandType,
  ContentEventType,
  ContentResourceType,
  ContentSchemaCode,
  type CalloutKind as CalloutKindCode,
  type ContentAlignment as ContentAlignmentCode,
  type ContentBlockType as ContentBlockTypeCode,
  type ContentDocumentType as ContentDocumentTypeCode,
  type GenerationSelectionAuthority as GenerationSelectionAuthorityCode,
  type QuestionSetEntryMode as QuestionSetEntryModeCode,
  type QuestionSetPracticeStatus as QuestionSetPracticeStatusCode,
  type QuestionTemplateCode as QuestionTemplateCodeValue,
  type QuestionPresentationCode as QuestionPresentationCodeValue,
  type QuestionRegionCode as QuestionRegionCodeValue,
  type QuestionRegionLayoutCode as QuestionRegionLayoutCodeValue
} from './domain/ContentCodes';
export {
  questionPresentationDefinition,
  questionRegionOrder,
  questionUsesMaterialWorkspace,
  resolveQuestionPresentation,
  type QuestionPresentationDefinition
} from './domain/QuestionPresentation';
export type {
  CommittedQuestionSetBundle,
  ContentDocumentRecord,
  ContentMetadataBundle,
  ContentRepository,
  ContentSchemaVersion,
  GenerationSpecRecord,
  GenerationWorkflowRecord,
  LectureRecord,
  QuestionCapabilityLink,
  QuestionRecord,
  QuestionSetLibraryEntry,
  QuestionSetLibraryQuery,
  QuestionSetSourceSummary,
  QuestionSetRecord,
  QuestionTemplateVersion
} from './contracts/ContentRepository';
export type { GenerationAggregate, GenerationRepository } from './contracts/GenerationRepository';
export type {
  QuestionLineageRecord,
  QuestionProvenanceView,
  QuestionSourceImportBundle,
  QuestionSourceImportReceipt,
  QuestionSourceLinkRecord,
  QuestionSourceRecord,
  QuestionSourceRepository
} from './contracts/QuestionSourceRepository';
export type {
  QuestionReferencePackRepository,
  TrueQuestionReferenceExample,
  TrueQuestionReferencePack
} from './contracts/QuestionReferencePackRepository';
export type {
  QuestionImportCandidateRecord,
  QuestionImportDraftAggregate,
  QuestionImportDraftRecord,
  QuestionImportDraftRepository,
  QuestionImportIssue,
  QuestionImportPublishReceipt,
  QuestionImportSourceMetadata
} from './contracts/QuestionImportDraftRepository';
export type {
  CalloutBlock,
  ContentBlock,
  ContentDocument,
  ContentDocumentEnvelope,
  DataTableBlock,
  DataTableCell,
  DataTableColumn,
  FormulaBlock,
  ImageBlock,
  TextBlock,
  SvgDiagramBlock
} from './contracts/ContentDocument';
export { contentBlockText, contentDocumentText } from './domain/ContentDocumentText';
export { questionSetPracticeStatusLabel } from './domain/QuestionSetPracticePresentation';
export type {
  QuestionContent,
  SingleChoiceOption,
  SingleChoiceQuestionContent
} from './contracts/QuestionContent';
export {
  LearningAssetKind,
  LearningAssetStatus,
  type LearningAssetKind as LearningAssetKindCode,
  type LearningAssetStatus as LearningAssetStatusCode
} from './domain/LearningAssetCodes';
export type {
  LearningAssetQuery,
  LearningAssetRecord,
  LearningAssetRepository
} from './contracts/LearningAssetRepository';
export {
  LearningAssetStore,
  type SaveLearningAssetCommand
} from './application/LearningAssetStore';
export {
  QuestionCalibrationRole,
  QuestionDerivationType,
  QuestionGenerationIntent,
  QuestionImportMethod,
  QuestionOriginType,
  QuestionSourceRelationRole,
  QuestionSourceStatus,
  type QuestionCalibrationRole as QuestionCalibrationRoleCode,
  type QuestionDerivationType as QuestionDerivationTypeCode,
  type QuestionGenerationIntent as QuestionGenerationIntentCode,
  type QuestionImportMethod as QuestionImportMethodCode,
  type QuestionOriginType as QuestionOriginTypeCode,
  type QuestionSourceRelationRole as QuestionSourceRelationRoleCode,
  type QuestionSourceStatus as QuestionSourceStatusCode
} from './domain/QuestionSourceCodes';
export {
  questionOriginLabel,
  questionSetLibraryTitle,
  questionSourceTitle
} from './domain/QuestionSourcePresentation';
export {
  QuestionImportCandidateStatus,
  QuestionImportDraftStatus,
  QuestionImportIssueCode,
  type QuestionImportCandidateStatus as QuestionImportCandidateStatusCode,
  type QuestionImportDraftStatus as QuestionImportDraftStatusCode,
  type QuestionImportIssueCode as QuestionImportIssueCodeValue
} from './domain/QuestionImportCodes';
export {
  ImportQuestionSource,
  QuestionSourceImportConflictError,
  type ImportQuestionLineage,
  type ImportQuestionSourceCommand,
  type ImportQuestionSourceLink,
  type ImportQuestionSourceResult
} from './application/ImportQuestionSource';
export { ArchiveQuestionSource } from './application/ArchiveQuestionSource';
export {
  BuildTrueQuestionReferencePack,
  TRUE_QUESTION_REFERENCE_POLICY_VERSION,
  type BuildTrueQuestionReferencePackCommand
} from './application/BuildTrueQuestionReferencePack';
export {
  ScanQuestionImportDraft,
  QuestionImportDraftConflictError,
  type QuestionImportDraftView,
  type ScanQuestionImportDraftCommand
} from './application/ScanQuestionImportDraft';
export {
  ConfirmQuestionImportDraft,
  type ConfirmQuestionImportDraftCommand
} from './application/ConfirmQuestionImportDraft';
export {
  PublishQuestionImportDraft,
  type PublishQuestionImportDraftCommand,
  type PublishQuestionImportDraftResult
} from './application/PublishQuestionImportDraft';
export {
  ContentSchemaValidator,
  type ContentValidationFailure,
  type ContentValidationIssue
} from './application/ContentSchemaValidator';
export { EnsureContentMetadata } from './application/EnsureContentMetadata';
export { createBundledContentMetadata } from './fixtures/bundledContentMetadata';
export { GenerationWorkflowMachine, type WorkflowAdvancePatch } from './domain/GenerationWorkflowMachine';
export {
  GenerationContextCompiler,
  GenerationEvidenceLevel,
  type CompiledGenerationContext,
  type GenerationContextRequest
} from './application/GenerationContextCompiler';
export {
  CreateGenerationWorkflow,
  type CreateGenerationWorkflowCommand
} from './application/CreateGenerationWorkflow';
export {
  GeneratedContentParser,
  GeneratedContentParseError,
  type GeneratedLectureQuestionSet
} from './application/GeneratedContentParser';
export {
  ContentQualityPriority,
  ContentReadiness,
  StructuredObjectiveContentQualityValidator,
  type ContentQualityIssue,
  type ContentQualityPriority as ContentQualityPriorityCode,
  type ContentQualityReport,
  type ContentReadiness as ContentReadinessCode
} from './application/StructuredObjectiveContentQualityValidator';
export {
  GeneratedContentCommitBuilder,
  type GeneratedContentCommit
} from './application/GeneratedContentCommitBuilder';
export {
  TrueQuestionStructuralDifferenceValidator,
  type TrueQuestionDifferenceResult
} from './application/TrueQuestionStructuralDifferenceValidator';
export {
  RunStructuredObjectiveGenerationWorkflow,
  type GenerationWorkflowProgress,
  type GenerationWorkflowResult
} from './application/RunStructuredObjectiveGenerationWorkflow';
export {
  GetGenerationStatus,
  type GenerationStatusView
} from './application/GetGenerationStatus';
