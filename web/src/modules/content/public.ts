export {
  CalloutKind,
  ContentAlignment,
  ContentBlockType,
  ContentDocumentType,
  QuestionTemplateCode,
  ContentAssetStatus,
  PublishedAssetStatus,
  QuestionQualityStatus,
  QuestionSetPurpose,
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
  type QuestionTemplateCode as QuestionTemplateCodeValue
} from './domain/ContentCodes';
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
  QuestionSetRecord,
  QuestionTemplateVersion
} from './contracts/ContentRepository';
export type { GenerationAggregate, GenerationRepository } from './contracts/GenerationRepository';
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
  MarkdownBlock,
  SvgDiagramBlock
} from './contracts/ContentDocument';
export type {
  QuestionContent,
  SingleChoiceOption,
  SingleChoiceQuestionContent
} from './contracts/QuestionContent';
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
  WeakeningContentQualityValidator,
  documentText,
  type ContentQualityIssue,
  type ContentQualityReport
} from './application/WeakeningContentQualityValidator';
export { GeneratedContentCommitBuilder } from './application/GeneratedContentCommitBuilder';
export {
  RunWeakeningGenerationWorkflow,
  type GenerationWorkflowResult
} from './application/RunWeakeningGenerationWorkflow';
export {
  GetGenerationStatus,
  type GenerationStatusView
} from './application/GetGenerationStatus';
