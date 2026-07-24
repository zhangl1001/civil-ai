export const AgentRunType = {
  TutorTurn: 'tutor_turn',
  ErrorDiagnosis: 'error_diagnosis',
  TeachingPlan: 'teaching_plan',
  ContentGeneration: 'content_generation',
  Review: 'review'
} as const;
export type AgentRunType = typeof AgentRunType[keyof typeof AgentRunType];

export const AgentRunStatus = {
  Queued: 'queued',
  Running: 'running',
  WaitingUser: 'waiting_user',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled'
} as const;
export type AgentRunStatus = typeof AgentRunStatus[keyof typeof AgentRunStatus];

export const AgentRunAction = {
  Start: 'start',
  WaitForUser: 'wait_for_user',
  Resume: 'resume',
  Retry: 'retry',
  Complete: 'complete',
  Fail: 'fail',
  Cancel: 'cancel'
} as const;
export type AgentRunAction = typeof AgentRunAction[keyof typeof AgentRunAction];

export const DEFAULT_MAX_CONCURRENT_AGENT_RUNS = 3;
