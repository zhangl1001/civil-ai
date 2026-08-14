import type { JsonObject } from '@/kernel/public';
import { ExamDeliveryKind } from '@/modules/curriculum/public';
import { defaultShortFormTopic } from '@/domain/writtenFormats';

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
    ...(text(input.payload?.dailyPlanId) ? { dailyPlanId: text(input.payload?.dailyPlanId)! } : {}),
    ...(text(input.payload?.dailyPlanItemId) ? { dailyPlanItemId: text(input.payload?.dailyPlanItemId)! } : {}),
    ...(text(input.payload?.capabilityNodeId) ? { capabilityNodeId: text(input.payload?.capabilityNodeId)! } : {}),
    ...(text(input.payload?.reviewQueueItemId) ? { reviewQueueItemId: text(input.payload?.reviewQueueItemId)! } : {}),
    ...(text(input.payload?.assessmentRole) ? { assessmentRole: text(input.payload?.assessmentRole)! } : {})
  };
  if (input.intent === 'trueQuestionResearch') return { mode: 'true', ...linkage };
  if (input.intent === 'essayGrade') {
    return {
      ...linkage,
      entryMode: text(input.payload?.entryMode) || 'self',
      ...(text(input.payload?.questionSetId) ? { questionSetId: text(input.payload?.questionSetId)! } : {}),
      topic: text(input.payload?.essayTopic) || defaultShortFormTopic() || '',
      date: text(input.payload?.essayDate) || '',
      type: text(input.payload?.essayType) === 'long' ? 'long' : 'short',
      purpose: text(input.payload?.purpose) || 'practice'
    };
  }
  // Written mocks are recognised by the delivery kind the caller sends. The
  // old check compared a payload field nobody set against a civil-service
  // subject name, so it never matched and could not have for another track.
  if (input.intent === 'mock' && input.payload?.deliveryKind === ExamDeliveryKind.Subjective) {
    return {
      ...linkage,
      entryMode: text(input.payload?.entryMode) || 'self',
      ...(text(input.payload?.questionSetId) ? { questionSetId: text(input.payload?.questionSetId)! } : {}),
      topic: text(input.payload?.essayTopic) || defaultShortFormTopic() || '',
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
