import type { MasteryTrack } from '../contracts/MasteryRepository';

export type DailyTeachingAction = 'review' | 'repair' | 'lecture' | 'guided_practice' | 'independent_practice' | 'transfer';

export const DailyLearningIntensity = {
  Light: 'light',
  Standard: 'standard',
  Focused: 'focused'
} as const;

export type DailyLearningIntensity = typeof DailyLearningIntensity[keyof typeof DailyLearningIntensity];

export interface DailyLearningLoadPrescription {
  readonly policyVersion: 'daily-learning-load@1.0.0';
  readonly intensity: DailyLearningIntensity;
  readonly availableMinutes: number;
  readonly remainingDays?: number;
  readonly maxPlanItems: number;
  readonly baselinePracticeCount: number;
  readonly digest: {
    readonly minimumThemes: number;
    readonly targetThemes: number;
    readonly maximumThemes: number;
  };
  readonly reasonCodes: readonly string[];
}

export function prescribeDailyLearningLoad(input: {
  readonly availableMinutes: number;
  readonly remainingDays?: number;
  readonly phase?: string;
  readonly dueReviewCount?: number;
  readonly priorityTracks?: readonly MasteryTrack[];
}): DailyLearningLoadPrescription {
  const availableMinutes = clamp(Math.round(input.availableMinutes), 5, 480);
  const remainingDays = normalizeRemainingDays(input.remainingDays);
  const tracks = input.priorityTracks ?? [];
  const dueReviewCount = Math.max(0, Math.round(input.dueReviewCount ?? 0));
  const averageAccuracy = average(tracks.map((track) => track.accuracy), 0.5);
  const averageConfidence = average(tracks.map((track) => track.confidence), 0);
  const weakTrackCount = tracks.filter((track) => track.state === 'regressed' || track.state === 'learning').length;
  const urgent = input.phase === 'sprint' || (remainingDays !== undefined && remainingDays <= 45);
  const light = availableMinutes < 35 || dueReviewCount >= 5;
  const focused = !light && (availableMinutes >= 90 || weakTrackCount >= 2 || averageAccuracy < 0.55);
  const intensity = light
    ? DailyLearningIntensity.Light
    : focused
      ? DailyLearningIntensity.Focused
      : DailyLearningIntensity.Standard;

  let digestTarget = availableMinutes < 35 ? 2 : availableMinutes < 75 ? 3 : availableMinutes < 150 ? 4 : 5;
  if (input.phase === 'foundation' && averageConfidence < 0.45) digestTarget += 1;
  if (urgent && availableMinutes < 90) digestTarget -= 1;
  if (dueReviewCount >= 5) digestTarget -= 1;
  digestTarget = clamp(digestTarget, 1, 6);

  const reasonCodes = [
    availableMinutes < 35 ? 'limited_time' : availableMinutes >= 90 ? 'extended_study_window' : 'standard_study_window',
    urgent ? 'exam_window_urgent' : 'exam_window_normal',
    weakTrackCount ? 'weak_capabilities_present' : 'capability_maintenance',
    dueReviewCount ? 'reviews_due' : 'no_reviews_due',
    averageConfidence < 0.45 ? 'evidence_confidence_low' : 'evidence_confidence_sufficient'
  ];

  return {
    policyVersion: 'daily-learning-load@1.0.0',
    intensity,
    availableMinutes,
    ...(remainingDays === undefined ? {} : { remainingDays }),
    maxPlanItems: clamp(Math.ceil(availableMinutes / 18), 1, 8),
    baselinePracticeCount: clamp(Math.round(availableMinutes / (urgent ? 6 : 7)), 4, urgent ? 15 : 12),
    digest: {
      minimumThemes: Math.max(1, digestTarget - 1),
      targetThemes: digestTarget,
      maximumThemes: Math.min(6, digestTarget + 1)
    },
    reasonCodes
  };
}

export function questionCountForDailyAction(
  action: DailyTeachingAction,
  targetMinutes: number,
  prescription: DailyLearningLoadPrescription
): number {
  const minutesPerQuestion: Readonly<Record<DailyTeachingAction, number>> = {
    review: 2.5,
    repair: 3,
    lecture: 4,
    guided_practice: 3.5,
    independent_practice: 2.8,
    transfer: 4.5
  };
  const minimum: Readonly<Record<DailyTeachingAction, number>> = {
    review: 3,
    repair: 3,
    lecture: 2,
    guided_practice: 3,
    independent_practice: 4,
    transfer: 2
  };
  const intensityFactor = prescription.intensity === DailyLearningIntensity.Focused
    ? 1.12
    : prescription.intensity === DailyLearningIntensity.Light
      ? 0.9
      : 1;
  const count = Math.round(Math.max(5, targetMinutes) / minutesPerQuestion[action] * intensityFactor);
  return clamp(count, minimum[action], action === 'independent_practice' ? 15 : 10);
}

function normalizeRemainingDays(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(value));
}

function average(values: readonly number[], fallback: number): number {
  if (!values.length) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
