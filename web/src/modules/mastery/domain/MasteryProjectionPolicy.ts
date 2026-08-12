import type { InstantMs } from '@/kernel/public';
import {
  ObjectiveEvidenceOrigin,
  objectiveEvidenceOriginFrom,
  objectiveEvidenceOriginReliability,
  type LearningEvidenceRecord
} from '@/modules/evidence/public';
import { AssessmentRole } from '@/kernel/assessmentRole';
import { MasteryState, type MasteryState as MasteryStateCode } from './MasteryCodes';
import type { MasteryTrack } from '../contracts/MasteryRepository';

export const MASTERY_ALGORITHM_VERSION = 'mastery-evidence:v3';

export interface MasteryProjectionInput {
  readonly current?: MasteryTrack;
  readonly evidence: readonly LearningEvidenceRecord[];
  readonly now: InstantMs;
}

export interface MasteryProjection {
  readonly state: MasteryStateCode;
  readonly concept: number;
  readonly recognition: number;
  readonly method: number;
  readonly accuracy: number;
  readonly speed: number;
  readonly retention: number;
  readonly transfer: number;
  readonly stability: number;
  readonly confidence: number;
  readonly effectiveSample: number;
  readonly lastEvidenceAt?: InstantMs;
}

/**
 * Deterministic, evidence-only mastery projection. It deliberately refuses to
 * infer retention or transfer from ordinary practice correctness.
 */
export function projectMastery(input: MasteryProjectionInput): MasteryProjection {
  const ordered = [...input.evidence].sort((left, right) => right.occurredAt - left.occurredAt);
  const correctness = aggregate(ordered.filter((item) => item.evidenceType === 'correctness'), input.now);
  const concept = aggregate(ordered.filter((item) => item.evidenceType === 'teaching_comprehension'), input.now);
  const recognition = aggregate(ordered.filter((item) => item.evidenceType === 'method_recognition'
    && (!item.metadata.masteryDimension || item.metadata.masteryDimension === 'recognition')), input.now);
  const speed = aggregate(ordered.filter((item) => item.evidenceType === 'speed'), input.now);
  const retention = aggregate(ordered.filter((item) => item.evidenceType === 'retention'
    || (item.assessmentRole === AssessmentRole.Retention && item.evidenceType === 'correctness')), input.now);
  const transfer = aggregate(ordered.filter((item) => item.evidenceType === 'transfer'
    || (item.assessmentRole === AssessmentRole.Transfer && item.evidenceType === 'correctness')), input.now);
  const method = aggregate(ordered.filter((item) => item.evidenceType === 'method_recognition'
    && (!item.metadata.masteryDimension || item.metadata.masteryDimension === 'method')), input.now);
  const effectiveSample = correctness.sample;
  const accuracy = correctness.value;
  const confidence = clamp((1 - Math.exp(-effectiveSample / 10)) * sourceDiversity(
    ordered.filter((item) => item.evidenceType === 'correctness'
      || item.evidenceType === 'retention'
      || item.evidenceType === 'transfer')
  ));
  const stability = clamp((accuracy * 0.35 + retention.value * 0.45 + transfer.value * 0.2) * confidence);
  const state = determineState({
    current: input.current?.state,
    effectiveSample,
    accuracy,
    concept: concept.present ? concept.value : 0,
    conceptPresent: concept.present,
    recognition: recognition.present ? recognition.value : 0,
    recognitionPresent: recognition.present,
    method: method.present ? method.value : 0,
    methodPresent: method.present,
    retention: retention.present ? retention.value : 0,
    transfer: transfer.present ? transfer.value : 0,
    confidence,
    stability
  });

  return {
    state,
    concept: concept.present ? concept.value : 0,
    recognition: recognition.present ? recognition.value : 0,
    method: method.present ? method.value : 0,
    accuracy,
    speed: speed.present ? speed.value : 0,
    retention: retention.present ? retention.value : 0,
    transfer: transfer.present ? transfer.value : 0,
    stability,
    confidence,
    effectiveSample: round(effectiveSample),
    lastEvidenceAt: ordered[0]?.occurredAt
  };
}

function aggregate(values: readonly LearningEvidenceRecord[], now: InstantMs): { value: number; sample: number; present: boolean } {
  let weightedTotal = 0;
  let weight = 0;
  for (const item of values) {
    if (item.value === undefined) continue;
    const ageDays = Math.max(0, Number(now) - Number(item.occurredAt)) / 86_400_000;
    const recency = Math.pow(0.5, ageDays / 45);
    const legacySourceFactor = item.validationPolicyVersion === 'aptitude-objective:v1'
      && (item.evidenceType === 'correctness' || item.evidenceType === 'speed')
      ? objectiveEvidenceOriginReliability(objectiveEvidenceOriginFrom(item.metadata.questionOriginType))
      : 1;
    const itemWeight = item.weight * item.quality * legacySourceFactor * recency;
    weightedTotal += clamp(item.value) * itemWeight;
    weight += itemWeight;
  }
  return { value: weight > 0 ? round(weightedTotal / weight) : 0, sample: weight, present: weight > 0 };
}

function sourceDiversity(evidence: readonly LearningEvidenceRecord[]): number {
  const roles = new Set(evidence.map((item) => item.assessmentRole));
  const origins = new Set(evidence.map((item) => objectiveEvidenceOriginFrom(item.metadata.questionOriginType)));
  const hasTrueQuestion = [...origins].some((origin) => (
    origin === ObjectiveEvidenceOrigin.OfficialTrue
    || origin === ObjectiveEvidenceOrigin.ImportedTrue
    || origin === ObjectiveEvidenceOrigin.UserTrue
  ));
  const roleFactor = roles.size >= 3 ? 1 : roles.size === 2 ? 0.9 : roles.size === 1 ? 0.78 : 0;
  const sourceFactor = hasTrueQuestion ? 1 : origins.size >= 2 ? 0.95 : 0.88;
  return roleFactor * sourceFactor;
}

function determineState(values: {
  readonly current?: MasteryStateCode;
  readonly effectiveSample: number;
  readonly accuracy: number;
  readonly concept: number;
  readonly conceptPresent: boolean;
  readonly recognition: number;
  readonly recognitionPresent: boolean;
  readonly method: number;
  readonly methodPresent: boolean;
  readonly retention: number;
  readonly transfer: number;
  readonly confidence: number;
  readonly stability: number;
}): MasteryStateCode {
  if (values.effectiveSample === 0) return MasteryState.Unassessed;
  if (values.effectiveSample < 2) return MasteryState.Diagnosed;
  if (values.accuracy < 0.45) return MasteryState.Regressed;
  const hasConfirmedStructuredGap = (values.conceptPresent && values.concept < 0.55)
    || (values.recognitionPresent && values.recognition < 0.55)
    || (values.methodPresent && values.method < 0.55);
  if (hasConfirmedStructuredGap) {
    return MasteryState.Learning;
  }
  if (values.accuracy < 0.7) return MasteryState.Practicing;
  if (values.retention < 0.68 || values.transfer < 0.65 || values.stability < 0.55) return MasteryState.Consolidating;
  const qualified = values.effectiveSample >= 18 && values.accuracy >= 0.82 && values.retention >= 0.75
    && values.transfer >= 0.72 && values.confidence >= 0.75;
  if (!qualified) return MasteryState.Consolidating;
  return values.current === MasteryState.Mastered || values.current === MasteryState.Maintaining
    ? MasteryState.Maintaining
    : MasteryState.Mastered;
}

function clamp(value: number): number { return Math.min(1, Math.max(0, value)); }
function round(value: number): number { return Math.round(value * 10_000) / 10_000; }
