export const ContentEnrichmentKind = {
  QuestionSet: 'question_set',
  QuestionImport: 'question_import',
  DailyDigest: 'daily_digest',
  LearningAsset: 'learning_asset'
} as const;

export type ContentEnrichmentKind =
  typeof ContentEnrichmentKind[keyof typeof ContentEnrichmentKind];
