export const PREPARATION_STRATEGY_POLICY_VERSION = 'preparation-strategy@1.0.0';

export const PreparationHorizon = {
  Extended: 'extended',
  Progressive: 'progressive',
  Consolidation: 'consolidation',
  Sprint: 'sprint'
} as const;

export type PreparationHorizon = typeof PreparationHorizon[keyof typeof PreparationHorizon];

export interface PreparationActionAllocation {
  readonly learn: number;
  readonly practice: number;
  readonly review: number;
  readonly assess: number;
  readonly accumulate: number;
}

export interface PreparationStrategy {
  readonly policyVersion: string;
  readonly horizon: PreparationHorizon;
  readonly remainingDays?: number;
  readonly urgency: number;
  readonly maximumNewCapabilities: number;
  readonly actionAllocation: PreparationActionAllocation;
  readonly timedPracticeRatio: number;
  readonly trueQuestionRatio: number;
  readonly reasonCodes: readonly string[];
}

interface PreparationStrategyThresholds {
  readonly sprintMaximumDays: number;
  readonly consolidationMaximumDays: number;
  readonly progressiveMaximumDays: number;
}

const THRESHOLDS: PreparationStrategyThresholds = {
  sprintMaximumDays: 30,
  consolidationMaximumDays: 90,
  progressiveMaximumDays: 180
};

const BASE_ALLOCATIONS: Readonly<Record<PreparationHorizon, PreparationActionAllocation>> = {
  extended: { learn: 0.34, practice: 0.34, review: 0.17, assess: 0.1, accumulate: 0.05 },
  progressive: { learn: 0.25, practice: 0.4, review: 0.2, assess: 0.1, accumulate: 0.05 },
  consolidation: { learn: 0.15, practice: 0.4, review: 0.25, assess: 0.15, accumulate: 0.05 },
  sprint: { learn: 0.08, practice: 0.4, review: 0.3, assess: 0.2, accumulate: 0.02 }
};

export function decidePreparationStrategy(input: {
  readonly remainingDays?: number;
  readonly averageScoreGapRatio?: number;
  readonly curriculumCoverageRatio?: number;
  readonly dueReviewCount?: number;
}): PreparationStrategy {
  const remainingDays = normalizeRemainingDays(input.remainingDays);
  const horizon = horizonFor(remainingDays);
  const averageScoreGapRatio = clamp01(input.averageScoreGapRatio ?? 0);
  const curriculumCoverageRatio = clamp01(input.curriculumCoverageRatio ?? 0);
  const dueReviewCount = Math.max(0, Math.round(input.dueReviewCount ?? 0));
  const base = BASE_ALLOCATIONS[horizon];

  const coverageAdjustment = horizon !== PreparationHorizon.Sprint && curriculumCoverageRatio < 0.45 ? 0.06 : 0;
  const reviewAdjustment = dueReviewCount >= 5 ? 0.08 : dueReviewCount > 0 ? 0.03 : 0;
  const scoreGapAdjustment = averageScoreGapRatio >= 0.25 ? 0.04 : 0;
  const actionAllocation = normalizeAllocation({
    learn: base.learn + coverageAdjustment,
    practice: base.practice + scoreGapAdjustment,
    review: base.review + reviewAdjustment,
    assess: base.assess,
    accumulate: base.accumulate
  });

  return {
    policyVersion: PREPARATION_STRATEGY_POLICY_VERSION,
    horizon,
    ...(remainingDays === undefined ? {} : { remainingDays }),
    urgency: urgencyFor(remainingDays),
    maximumNewCapabilities: horizon === PreparationHorizon.Extended
      ? 3
      : horizon === PreparationHorizon.Progressive
        ? 2
        : 1,
    actionAllocation,
    timedPracticeRatio: horizon === PreparationHorizon.Sprint ? 0.55 : horizon === PreparationHorizon.Consolidation ? 0.35 : 0.15,
    trueQuestionRatio: horizon === PreparationHorizon.Sprint ? 0.65 : horizon === PreparationHorizon.Consolidation ? 0.45 : 0.2,
    reasonCodes: [
      `horizon_${horizon}`,
      curriculumCoverageRatio < 0.45 ? 'curriculum_coverage_incomplete' : 'curriculum_coverage_established',
      dueReviewCount > 0 ? 'reviews_due' : 'no_reviews_due',
      averageScoreGapRatio >= 0.25 ? 'score_gap_material' : 'score_gap_controlled'
    ]
  };
}

function horizonFor(remainingDays: number | undefined): PreparationHorizon {
  if (remainingDays === undefined || remainingDays > THRESHOLDS.progressiveMaximumDays) return PreparationHorizon.Extended;
  if (remainingDays <= THRESHOLDS.sprintMaximumDays) return PreparationHorizon.Sprint;
  if (remainingDays <= THRESHOLDS.consolidationMaximumDays) return PreparationHorizon.Consolidation;
  return PreparationHorizon.Progressive;
}

function urgencyFor(remainingDays: number | undefined): number {
  if (remainingDays === undefined) return 0.25;
  return clamp01(1 - remainingDays / 365);
}

function normalizeRemainingDays(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(value));
}

function normalizeAllocation(value: PreparationActionAllocation): PreparationActionAllocation {
  const total = Object.values(value).reduce((sum, current) => sum + current, 0) || 1;
  return {
    learn: round(value.learn / total),
    practice: round(value.practice / total),
    review: round(value.review / total),
    assess: round(value.assess / total),
    accumulate: round(value.accumulate / total)
  };
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
