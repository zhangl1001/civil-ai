import type { CapabilityNodeId, InstantMs, JsonObject, SubjectCode } from '@/kernel/public';
import type { MasteryState } from './MasteryCodes';

export const LearnerPriorityAction = {
  Diagnose: 'diagnose',
  Learn: 'learn',
  Practice: 'practice',
  Review: 'review',
  Maintain: 'maintain'
} as const;

export type LearnerPriorityAction = typeof LearnerPriorityAction[keyof typeof LearnerPriorityAction];

export const CapabilityRecommendationMode = {
  Normal: 'normal',
  Deprioritized: 'deprioritized',
  Paused: 'paused'
} as const;

export type CapabilityRecommendationMode = typeof CapabilityRecommendationMode[keyof typeof CapabilityRecommendationMode];

export interface CapabilityRecommendationPreference {
  readonly mode: CapabilityRecommendationMode;
  readonly reason?: string;
  readonly pausedUntil?: InstantMs;
  readonly updatedAt?: InstantMs;
}

export interface LearnerPrioritySignal {
  readonly capabilityNodeId: CapabilityNodeId;
  readonly subject: SubjectCode;
  readonly module: string;
  readonly name: string;
  readonly scoreWeight: number;
  readonly scoreGapRatio: number;
  readonly state: MasteryState;
  readonly accuracy: number;
  readonly speed: number;
  readonly retention: number;
  readonly transfer: number;
  readonly stability: number;
  readonly confidence: number;
  readonly effectiveSample: number;
  readonly lastEvidenceAt?: InstantMs;
  readonly learningStatus?: 'started' | 'completed';
  readonly learningCompletedAt?: InstantMs;
  readonly preference?: CapabilityRecommendationPreference;
}

export interface LearnerPriorityResult extends LearnerPrioritySignal {
  readonly priority: number;
  readonly action: LearnerPriorityAction;
  readonly evidenceConfidence: number;
  readonly evidenceAgeDays?: number;
  readonly reliable: boolean;
  readonly eligible: boolean;
  readonly reasonCodes: readonly string[];
}

/**
 * Produces a single, explainable ranking without mutating mastery evidence.
 * User preferences and completed learning affect recommendations, never scores.
 */
export function rankLearnerPriorities(
  signals: readonly LearnerPrioritySignal[],
  now: InstantMs
): readonly LearnerPriorityResult[] {
  return signals
    .map((signal) => evaluateLearnerPriority(signal, now))
    .filter((result) => result.eligible)
    .sort((left, right) => (
      right.priority - left.priority
      || Number(right.reliable) - Number(left.reliable)
      || left.effectiveSample - right.effectiveSample
      || left.capabilityNodeId.localeCompare(right.capabilityNodeId)
    ));
}

export function readCapabilityRecommendationPreferences(
  extension: JsonObject
): ReadonlyMap<CapabilityNodeId, CapabilityRecommendationPreference> {
  const raw = extension.capabilityRecommendations;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();
  const result = new Map<CapabilityNodeId, CapabilityRecommendationPreference>();
  Object.entries(raw).forEach(([id, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const mode = value.mode;
    if (mode !== CapabilityRecommendationMode.Normal
      && mode !== CapabilityRecommendationMode.Deprioritized
      && mode !== CapabilityRecommendationMode.Paused) return;
    result.set(id as CapabilityNodeId, {
      mode,
      ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
      ...(typeof value.pausedUntil === 'number' ? { pausedUntil: value.pausedUntil as InstantMs } : {}),
      ...(typeof value.updatedAt === 'number' ? { updatedAt: value.updatedAt as InstantMs } : {})
    });
  });
  return result;
}

export function evaluateLearnerPriority(
  signal: LearnerPrioritySignal,
  now: InstantMs
): LearnerPriorityResult {
  const accuracy = clamp01(signal.accuracy);
  const stability = clamp01(signal.stability);
  const retention = clamp01(signal.retention);
  const transfer = clamp01(signal.transfer);
  const confidence = clamp01(signal.confidence);
  const effectiveSample = Math.max(0, signal.effectiveSample);
  const evidenceConfidence = clamp01(confidence * Math.min(1, effectiveSample / 8));
  const evidenceAgeDays = signal.lastEvidenceAt === undefined
    ? undefined
    : Math.max(0, (Number(now) - Number(signal.lastEvidenceAt)) / 86_400_000);
  const freshnessRisk = evidenceAgeDays === undefined ? 0.45 : clamp01(evidenceAgeDays / 90);
  const observedWeakness = 1 - (accuracy * 0.38 + stability * 0.24 + retention * 0.2 + transfer * 0.18);
  const weakness = effectiveSample > 0 ? observedWeakness : 0.35;
  const weaknessReliability = 0.2 + evidenceConfidence * 0.8;
  const evidenceNeed = 1 - evidenceConfidence;
  const reliable = effectiveSample >= 5 && evidenceConfidence >= 0.35;
  const preference = signal.preference;
  const paused = preference?.mode === CapabilityRecommendationMode.Paused
    && (preference.pausedUntil === undefined || Number(preference.pausedUntil) > Number(now));
  const deprioritized = preference?.mode === CapabilityRecommendationMode.Deprioritized;
  const learnedWithoutValidation = signal.learningStatus === 'completed'
    && signal.learningCompletedAt !== undefined
    && (signal.lastEvidenceAt === undefined || Number(signal.learningCompletedAt) >= Number(signal.lastEvidenceAt));
  const statePriority = stateWeight(signal.state);
  const priority = roundPriority(
    22
    + weakness * weaknessReliability * 43
    + evidenceNeed * 8
    + freshnessRisk * 13
    + Math.max(0, signal.scoreWeight) * 35
    + clamp01(signal.scoreGapRatio) * 13
    + statePriority
    + (learnedWithoutValidation ? 8 : 0)
    - (deprioritized ? 42 : 0)
  );
  const action = recommendedAction(signal, { reliable, learnedWithoutValidation, freshnessRisk });
  const reasonCodes = [
    ...(reliable && weakness >= 0.45 ? ['ability_gap'] : []),
    ...(!reliable ? ['evidence_insufficient'] : []),
    ...(freshnessRisk >= 0.35 ? ['evidence_aging'] : []),
    ...(learnedWithoutValidation ? ['learning_needs_validation'] : []),
    ...(deprioritized ? ['user_deprioritized'] : [])
  ];
  return {
    ...signal,
    priority,
    action,
    evidenceConfidence: round(evidenceConfidence),
    ...(evidenceAgeDays === undefined ? {} : { evidenceAgeDays: round(evidenceAgeDays) }),
    reliable,
    eligible: !paused,
    reasonCodes
  };
}

function recommendedAction(
  signal: LearnerPrioritySignal,
  context: { readonly reliable: boolean; readonly learnedWithoutValidation: boolean; readonly freshnessRisk: number }
): LearnerPriorityAction {
  if (context.learnedWithoutValidation) return LearnerPriorityAction.Practice;
  if (!context.reliable) return LearnerPriorityAction.Diagnose;
  if (signal.state === 'regressed' || signal.accuracy < 0.55) return LearnerPriorityAction.Learn;
  if (context.freshnessRisk >= 0.35 || signal.retention < 0.6) return LearnerPriorityAction.Review;
  if (signal.transfer < 0.65 || signal.stability < 0.7) return LearnerPriorityAction.Practice;
  return LearnerPriorityAction.Maintain;
}

function stateWeight(state: MasteryState): number {
  if (state === 'regressed') return 16;
  if (state === 'learning') return 11;
  if (state === 'practicing') return 8;
  if (state === 'diagnosed') return 6;
  if (state === 'consolidating') return 3;
  return 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function roundPriority(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}
