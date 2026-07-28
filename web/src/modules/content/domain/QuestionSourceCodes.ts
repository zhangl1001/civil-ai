export const QuestionOriginType = {
  Official: 'official',
  Imported: 'imported',
  UserCreated: 'user_created',
  AiGenerated: 'ai_generated',
  AiVariant: 'ai_variant',
  DiagnosticAnchor: 'diagnostic_anchor'
} as const;

export type QuestionOriginType = typeof QuestionOriginType[keyof typeof QuestionOriginType];

export const QuestionSourceStatus = {
  Active: 'active',
  Archived: 'archived',
  Rejected: 'rejected'
} as const;

export type QuestionSourceStatus = typeof QuestionSourceStatus[keyof typeof QuestionSourceStatus];

export const QuestionSourceRelationRole = {
  Original: 'original',
  Reference: 'reference',
  Calibration: 'calibration'
} as const;

export type QuestionSourceRelationRole =
  typeof QuestionSourceRelationRole[keyof typeof QuestionSourceRelationRole];

export const QuestionDerivationType = {
  Variant: 'variant',
  DifficultyAdjustment: 'difficulty_adjustment',
  Transfer: 'transfer',
  Repair: 'repair'
} as const;

export type QuestionDerivationType = typeof QuestionDerivationType[keyof typeof QuestionDerivationType];

export const QuestionCalibrationRole = {
  None: 'none',
  Anchor: 'anchor',
  StyleReference: 'style_reference',
  DifficultyReference: 'difficulty_reference',
  DistributionReference: 'distribution_reference'
} as const;

export type QuestionCalibrationRole =
  typeof QuestionCalibrationRole[keyof typeof QuestionCalibrationRole];

export const QuestionImportMethod = {
  ManualText: 'manual_text',
  StructuredFile: 'structured_file',
  DocumentScan: 'document_scan',
  ImageOcr: 'image_ocr',
  WebResearch: 'web_research',
  Bundled: 'bundled',
  AgentCreated: 'agent_created',
  SystemGenerated: 'system_generated'
} as const;

export type QuestionImportMethod = typeof QuestionImportMethod[keyof typeof QuestionImportMethod];

export const QuestionGenerationIntent = {
  DiagnosticBaseline: 'diagnostic_baseline',
  TargetedTraining: 'targeted_training',
  RetentionReview: 'retention_review',
  TransferAssessment: 'transfer_assessment',
  TrueQuestionCalibration: 'true_question_calibration',
  UserDirected: 'user_directed'
} as const;

export type QuestionGenerationIntent =
  typeof QuestionGenerationIntent[keyof typeof QuestionGenerationIntent];
