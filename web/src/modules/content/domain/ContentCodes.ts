export const ContentBlockType = {
  Text: 'text',
  DataTable: 'data_table',
  SvgDiagram: 'svg_diagram',
  Image: 'image',
  Formula: 'formula',
  Callout: 'callout'
} as const;

export type ContentBlockType = typeof ContentBlockType[keyof typeof ContentBlockType];

export const ContentDocumentType = {
  Lecture: 'lecture',
  Question: 'question',
  Explanation: 'explanation',
  WrongCause: 'wrong_cause',
  Feedback: 'feedback'
} as const;

export type ContentDocumentType = typeof ContentDocumentType[keyof typeof ContentDocumentType];

export const CalloutKind = {
  Method: 'method',
  Trap: 'trap',
  Hint: 'hint',
  Conclusion: 'conclusion',
  WrongCause: 'wrong_cause'
} as const;

export type CalloutKind = typeof CalloutKind[keyof typeof CalloutKind];

export const ContentAlignment = {
  Left: 'left',
  Center: 'center',
  Right: 'right'
} as const;

export type ContentAlignment = typeof ContentAlignment[keyof typeof ContentAlignment];

export const QuestionTemplateCode = {
  SingleChoice: 'single_choice'
} as const;

export type QuestionTemplateCode = typeof QuestionTemplateCode[keyof typeof QuestionTemplateCode];

export const PublishedAssetStatus = {
  Draft: 'draft',
  Published: 'published',
  Retired: 'retired'
} as const;

export type PublishedAssetStatus = typeof PublishedAssetStatus[keyof typeof PublishedAssetStatus];

export const ContentAssetStatus = {
  Staged: 'staged',
  Validated: 'validated',
  Published: 'published',
  Rejected: 'rejected',
  Retired: 'retired'
} as const;

export type ContentAssetStatus = typeof ContentAssetStatus[keyof typeof ContentAssetStatus];

export const QuestionSetStatus = {
  Staging: 'staging',
  Ready: 'ready',
  Retired: 'retired',
  Rejected: 'rejected'
} as const;

export type QuestionSetStatus = typeof QuestionSetStatus[keyof typeof QuestionSetStatus];

export const QuestionSetPracticeStatus = {
  NotStarted: 'not_started',
  InProgress: 'in_progress',
  Completed: 'completed'
} as const;

export type QuestionSetPracticeStatus = typeof QuestionSetPracticeStatus[keyof typeof QuestionSetPracticeStatus];

export const QuestionQualityStatus = {
  Staged: 'staged',
  Validated: 'validated',
  Published: 'published',
  Rejected: 'rejected',
  Retired: 'retired'
} as const;

export type QuestionQualityStatus = typeof QuestionQualityStatus[keyof typeof QuestionQualityStatus];

export const QuestionSetPurpose = {
  Diagnosis: 'diagnosis',
  Teaching: 'teaching',
  Guided: 'guided',
  Practice: 'practice',
  Retention: 'retention',
  Transfer: 'transfer',
  Anchor: 'anchor',
  Mock: 'mock'
} as const;

export type QuestionSetPurpose = typeof QuestionSetPurpose[keyof typeof QuestionSetPurpose];

export const QuestionSetEntryMode = {
  Tutor: 'tutor',
  Self: 'self'
} as const;

export type QuestionSetEntryMode = typeof QuestionSetEntryMode[keyof typeof QuestionSetEntryMode];

export const GenerationSelectionAuthority = {
  TutorEngine: 'tutor_engine',
  User: 'user'
} as const;

export type GenerationSelectionAuthority = typeof GenerationSelectionAuthority[keyof typeof GenerationSelectionAuthority];

export const GenerationWorkflowStatus = {
  Queued: 'queued',
  Running: 'running',
  Validating: 'validating',
  Staged: 'staged',
  Committed: 'committed',
  Failed: 'failed',
  Cancelled: 'cancelled'
} as const;

export type GenerationWorkflowStatus = typeof GenerationWorkflowStatus[keyof typeof GenerationWorkflowStatus];

export const GenerationWorkflowStep = {
  PrepareContext: 'prepare_context',
  CompilePrompt: 'compile_prompt',
  InvokeModel: 'invoke_model',
  ParseStructure: 'parse_structure',
  ValidateSchema: 'validate_schema',
  ValidateDomain: 'validate_domain',
  QualityReview: 'quality_review',
  StageResult: 'stage_result',
  CommitResult: 'commit_result',
  PublishOutbox: 'publish_outbox',
  Complete: 'complete'
} as const;

export type GenerationWorkflowStep = typeof GenerationWorkflowStep[keyof typeof GenerationWorkflowStep];

export const ContentSchemaCode = {
  Document: 'content.document',
  SingleChoiceQuestion: 'question.single_choice'
} as const;

export const ContentCommandType = {
  CreateGeneration: 'content.create_generation'
} as const;

export const ContentEventType = {
  GenerationRequested: 'content.generation_requested',
  QuestionSetCommitted: 'content.question_set_committed'
} as const;

export const ContentResourceType = {
  GenerationWorkflow: 'generation_workflow',
  QuestionSet: 'question_set'
} as const;
