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

/**
 * Scheduling class is orthogonal to the business work pool.
 * External research is deliberately isolated so a long web crawl cannot
 * consume every slot used by interactive tutoring and content generation.
 */
export const AgentExecutionClass = {
  General: 'general',
  ExternalResearch: 'external_research'
} as const;
export type AgentExecutionClass = typeof AgentExecutionClass[keyof typeof AgentExecutionClass];

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

export function resolveAgentExecutionClass(
  _runType: AgentRunType,
  targetResourceType?: string,
  inputSnapshot: Readonly<Record<string, unknown>> = {}
): AgentExecutionClass {
  const intent = typeof inputSnapshot.intent === 'string' ? inputSnapshot.intent : '';
  return targetResourceType === 'business_operation' && intent === 'trueQuestionResearch'
    ? AgentExecutionClass.ExternalResearch
    : AgentExecutionClass.General;
}
