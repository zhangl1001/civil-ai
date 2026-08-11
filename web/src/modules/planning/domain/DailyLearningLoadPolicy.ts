import { DailyPlanItemType, type DailyPlanItemType as DailyPlanItemTypeCode } from './DailyPlanCodes';
import { PreparationHorizon, type PreparationStrategy } from './PreparationStrategyPolicy';

export const DailyLearningIntensity = {
  Light: 'light',
  Standard: 'standard',
  Focused: 'focused'
} as const;

export type DailyLearningIntensity = typeof DailyLearningIntensity[keyof typeof DailyLearningIntensity];

export const DAILY_LEARNING_LOAD_POLICY_VERSION = 'daily-learning-load@2.1.0';

export interface PlanningCapabilitySignal {
  readonly state: string;
  readonly accuracy: number;
  readonly confidence: number;
}

export interface DailyLearningLoadPrescription {
  readonly policyVersion: string;
  readonly intensity: DailyLearningIntensity;
  readonly availableMinutes: number;
  readonly remainingDays?: number;
  readonly maximumPlanItems: number;
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
  readonly strategy: PreparationStrategy;
  readonly dueReviewCount?: number;
  readonly prioritySignals?: readonly PlanningCapabilitySignal[];
}): DailyLearningLoadPrescription {
  const availableMinutes = clamp(Math.round(input.availableMinutes), 5, 480);
  const signals = input.prioritySignals ?? [];
  const dueReviewCount = Math.max(0, Math.round(input.dueReviewCount ?? 0));
  const averageAccuracy = average(signals.map((signal) => signal.accuracy), 0.5);
  const weakSignalCount = signals.filter((signal) => signal.state === 'regressed' || signal.state === 'learning').length;
  const isLight = availableMinutes < 35 || dueReviewCount >= 5;
  const isFocused = !isLight && (availableMinutes >= 90 || weakSignalCount >= 2 || averageAccuracy < 0.55);
  const intensity = isLight
    ? DailyLearningIntensity.Light
    : isFocused
      ? DailyLearningIntensity.Focused
      : DailyLearningIntensity.Standard;

  let digestTarget = availableMinutes < 35 ? 2 : availableMinutes < 75 ? 3 : availableMinutes < 150 ? 4 : 5;
  if (input.strategy.horizon === PreparationHorizon.Extended && average(signals.map((signal) => signal.confidence), 0) < 0.45) {
    digestTarget += 1;
  }
  if (input.strategy.horizon === PreparationHorizon.Sprint && availableMinutes < 90) digestTarget -= 1;
  if (dueReviewCount >= 5) digestTarget -= 1;
  digestTarget = clamp(digestTarget, 1, 6);

  return {
    policyVersion: DAILY_LEARNING_LOAD_POLICY_VERSION,
    intensity,
    availableMinutes,
    ...(input.strategy.remainingDays === undefined ? {} : { remainingDays: input.strategy.remainingDays }),
    maximumPlanItems: clamp(Math.ceil(availableMinutes / 15), 1, 12),
    baselinePracticeCount: clamp(
      Math.round(availableMinutes / (input.strategy.horizon === PreparationHorizon.Sprint ? 5.5 : 7)),
      4,
      input.strategy.horizon === PreparationHorizon.Sprint ? 20 : 15
    ),
    digest: {
      minimumThemes: Math.max(1, digestTarget - 1),
      targetThemes: digestTarget,
      maximumThemes: Math.min(6, digestTarget + 1)
    },
    reasonCodes: [
      availableMinutes < 35 ? 'limited_time' : availableMinutes >= 90 ? 'extended_study_window' : 'standard_study_window',
      ...input.strategy.reasonCodes,
      weakSignalCount ? 'weak_capabilities_present' : 'capability_maintenance',
      dueReviewCount ? 'reviews_due' : 'no_reviews_due'
    ]
  };
}

export function targetCountForPlanItem(
  itemType: DailyPlanItemTypeCode,
  targetMinutes: number,
  prescription: DailyLearningLoadPrescription,
  targetSeconds?: number
): number | undefined {
  if (itemType === DailyPlanItemType.Lecture
    || itemType === DailyPlanItemType.Digest
    || itemType === DailyPlanItemType.Essay) return undefined;

  const defaultMinutesPerUnit: Readonly<Partial<Record<DailyPlanItemTypeCode, number>>> = {
    diagnosis: 4,
    guided_practice: 3.5,
    independent_practice: 2.8,
    variant: 4,
    timed: 2.2,
    review: 2.5,
    transfer: 4.5,
    mock: 1.2
  };
  const secondsPerUnit = targetSeconds && targetSeconds > 0
    ? targetSeconds
    : (defaultMinutesPerUnit[itemType] ?? 3) * 60;
  const intensityFactor = prescription.intensity === DailyLearningIntensity.Focused
    ? 1.08
    : prescription.intensity === DailyLearningIntensity.Light
      ? 0.9
      : 1;
  const count = Math.round(Math.max(5, targetMinutes) * 60 / secondsPerUnit * intensityFactor);
  const minimum = itemType === DailyPlanItemType.Mock ? 10 : itemType === DailyPlanItemType.Transfer ? 2 : 3;
  const maximum = itemType === DailyPlanItemType.Mock ? 60 : itemType === DailyPlanItemType.Timed ? 25 : 20;
  return clamp(count, minimum, maximum);
}

function average(values: readonly number[], fallback: number): number {
  if (!values.length) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
