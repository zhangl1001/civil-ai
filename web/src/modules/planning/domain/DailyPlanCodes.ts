export const DailyPlanStatus = {
  Draft: 'draft',
  Active: 'active',
  Superseded: 'superseded',
  Completed: 'completed',
  Cancelled: 'cancelled'
} as const;

export type DailyPlanStatus = typeof DailyPlanStatus[keyof typeof DailyPlanStatus];

export const DailyPlanItemStatus = {
  Pending: 'pending',
  InProgress: 'in_progress',
  Completed: 'completed',
  Skipped: 'skipped',
  Cancelled: 'cancelled'
} as const;

export type DailyPlanItemStatus = typeof DailyPlanItemStatus[keyof typeof DailyPlanItemStatus];

export const DailyPlanItemType = {
  Diagnosis: 'diagnosis',
  Lecture: 'lecture',
  GuidedPractice: 'guided_practice',
  IndependentPractice: 'independent_practice',
  Variant: 'variant',
  Timed: 'timed',
  Review: 'review',
  Transfer: 'transfer',
  Mock: 'mock',
  Essay: 'essay',
  Digest: 'digest'
} as const;

export type DailyPlanItemType = typeof DailyPlanItemType[keyof typeof DailyPlanItemType];

export const DailyPlanDigestType = {
  CurrentAffairs: 'news',
  KnowledgeTips: 'tips'
} as const;

export type DailyPlanDigestType = typeof DailyPlanDigestType[keyof typeof DailyPlanDigestType];

export const DailyPlanItemCategory = {
  Learn: 'learn',
  Practice: 'practice',
  Review: 'review',
  Assess: 'assess',
  Accumulate: 'accumulate'
} as const;

export type DailyPlanItemCategory = typeof DailyPlanItemCategory[keyof typeof DailyPlanItemCategory];

export function isDailyPlanItemCategory(value: unknown): value is DailyPlanItemCategory {
  return typeof value === 'string'
    && Object.values(DailyPlanItemCategory).includes(value as DailyPlanItemCategory);
}

export const DailyPlanRebalanceReason = {
  LearningResult: 'learning_result',
  UserRequested: 'user_requested',
  ReviewChanged: 'review_changed'
} as const;

export type DailyPlanRebalanceReason = typeof DailyPlanRebalanceReason[keyof typeof DailyPlanRebalanceReason];
