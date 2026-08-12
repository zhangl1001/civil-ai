import type { JsonObject } from '@/kernel/public';

export type GenerationIntent =
  | 'daily'
  | 'practice'
  | 'essayGrade'
  | 'mock'
  | 'redo'
  | 'digest'
  | 'monthlyDigest'
  | 'study'
  | 'interviewQuestions'
  | 'interviewReview'
  | 'trueQuestionResearch';

export interface GenerationTaskInput {
  readonly intent: GenerationIntent;
  readonly idempotencyKey?: string;
  readonly title?: string;
  readonly detail?: string;
  readonly module?: string;
  readonly sourceId?: string;
  readonly scopeId?: string;
  readonly payload?: Record<string, unknown>;
}

export function generationTaskScope(projectId: string, input: GenerationTaskInput): string {
  const source = input.scopeId || input.sourceId || input.module || input.intent;
  return `${input.intent}:${projectId}:${source}`;
}

export function generationTaskActionParams(input: GenerationTaskInput): JsonObject {
  const linkage = {
    ...(text(input.payload?.dailyPlanItemId) ? { dailyPlanItemId: text(input.payload?.dailyPlanItemId)! } : {}),
    ...(text(input.payload?.capabilityNodeId) ? { capabilityNodeId: text(input.payload?.capabilityNodeId)! } : {}),
    ...(text(input.payload?.reviewQueueItemId) ? { reviewQueueItemId: text(input.payload?.reviewQueueItemId)! } : {})
  };
  if (input.intent === 'trueQuestionResearch') return { mode: 'true', ...linkage };
  if (input.intent === 'essayGrade') {
    return {
      ...linkage,
      entryMode: text(input.payload?.entryMode) || 'self',
      ...(text(input.payload?.questionSetId) ? { questionSetId: text(input.payload?.questionSetId)! } : {}),
      topic: text(input.payload?.essayTopic) || '申论',
      date: text(input.payload?.essayDate) || '',
      type: text(input.payload?.essayType) === 'long' ? 'long' : 'short',
      purpose: text(input.payload?.purpose) || 'practice'
    };
  }
  if (input.intent === 'mock' && input.payload?.subject === '申论') {
    return {
      ...linkage,
      entryMode: text(input.payload?.entryMode) || 'self',
      ...(text(input.payload?.questionSetId) ? { questionSetId: text(input.payload?.questionSetId)! } : {}),
      topic: text(input.payload?.essayTopic) || '申论',
      date: text(input.payload?.date) || '',
      type: text(input.payload?.essayType) === 'long' ? 'long' : 'short',
      purpose: text(input.payload?.purpose) || 'practice',
      questionCount: Number(input.payload?.essayQuestionCount || 1)
    };
  }
  return linkage;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
