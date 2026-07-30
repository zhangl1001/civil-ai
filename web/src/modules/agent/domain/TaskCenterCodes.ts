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

export const AgentRunNotificationMode = {
  Lifecycle: 'lifecycle',
  Terminal: 'terminal',
  Silent: 'silent'
} as const;

export type AgentRunNotificationMode =
  typeof AgentRunNotificationMode[keyof typeof AgentRunNotificationMode];

export function resolveAgentRunNotificationMode(
  inputSnapshot: Readonly<Record<string, unknown>>
): AgentRunNotificationMode {
  const explicit = inputSnapshot.notificationMode;
  if (Object.values(AgentRunNotificationMode).includes(explicit as AgentRunNotificationMode)) {
    return explicit as AgentRunNotificationMode;
  }
  // Keep runs created by older app versions readable during an in-place upgrade.
  if (inputSnapshot.notifyOnTerminal === true) return AgentRunNotificationMode.Terminal;
  return AgentRunNotificationMode.Lifecycle;
}
