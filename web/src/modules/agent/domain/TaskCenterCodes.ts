export const TaskCenterStep = {
  Queued: 'queued',
  ResolvingPlan: 'resolving_plan',
  PreparingContext: 'preparing_context',
  CompilingPrompt: 'compiling_prompt',
  InvokingModel: 'invoking_model',
  ParsingResponse: 'parsing_response',
  ValidatingContent: 'validating_content',
  CommittingResult: 'committing_result',
  Completed: 'completed'
} as const;

export type TaskCenterStep = typeof TaskCenterStep[keyof typeof TaskCenterStep];

export const TaskTargetType = {
  StructuredPractice: 'structured_practice',
  ContentEnrichment: 'content_enrichment',
  ChatTool: 'chat_tool',
  BusinessOperation: 'business_operation',
  ErrorDiagnosisBatch: 'error_diagnosis_batch'
} as const;

export type TaskTargetType = typeof TaskTargetType[keyof typeof TaskTargetType];
