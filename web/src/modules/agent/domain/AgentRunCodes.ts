import { TaskStatus } from '@/modules/task/public';

export const AgentRunType = {
  TutorTurn: 'tutor_turn',
  ErrorDiagnosis: 'error_diagnosis',
  TeachingPlan: 'teaching_plan',
  ContentGeneration: 'content_generation',
  Review: 'review'
} as const;
export type AgentRunType = typeof AgentRunType[keyof typeof AgentRunType];

export const AgentWorkPool = {
  ContentGeneration: 'content_generation',
  Assessment: 'assessment',
  Interactive: 'interactive',
  Background: 'background'
} as const;
export type AgentWorkPool = typeof AgentWorkPool[keyof typeof AgentWorkPool];

export const AgentRunStatus = {
  Queued: TaskStatus.Queued,
  Running: TaskStatus.Running,
  WaitingUser: TaskStatus.WaitingForUser,
  Completed: TaskStatus.Completed,
  Failed: TaskStatus.Failed,
  Cancelled: TaskStatus.Cancelled
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

export function resolveAgentWorkPool(
  runType: AgentRunType,
  targetResourceType?: string,
  inputSnapshot: Readonly<Record<string, unknown>> = {}
): AgentWorkPool {
  if (runType === AgentRunType.ContentGeneration) return AgentWorkPool.ContentGeneration;
  if (runType === AgentRunType.ErrorDiagnosis) return AgentWorkPool.Assessment;
  if (runType === AgentRunType.TeachingPlan || runType === AgentRunType.Review) {
    return AgentWorkPool.Background;
  }
  const intent = typeof inputSnapshot.intent === 'string' ? inputSnapshot.intent : '';
  if (
    targetResourceType === 'business_operation'
    && (intent === 'essayGrade' || intent === 'interviewReview')
  ) {
    return AgentWorkPool.Assessment;
  }
  return AgentWorkPool.Interactive;
}
