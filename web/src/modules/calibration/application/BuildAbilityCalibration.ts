import type { UnitOfWork } from '@/capabilities/database/public';
import {
  sha256Json,
  type Clock,
  type IdGenerator,
  type JsonValue
} from '@/kernel/public';
import type { CandidateRepository, ScoreMeasurement } from '@/modules/candidate/public';
import { ScoreMeasurementType } from '@/modules/candidate/public';
import {
  ExamDeliveryKind,
  projectExamSubjects,
  type CapabilityNode,
  type CurriculumBundle,
  type CurriculumRepository
} from '@/modules/curriculum/public';
import type { LearningEvidenceRecord, LearningEvidenceRepository, ObjectiveEvidenceOriginCode } from '@/modules/evidence/public';
import {
  AssessmentRole,
  ObjectiveEvidenceOrigin,
  objectiveEvidenceOriginFrom,
  objectiveEvidenceOriginReliability
} from '@/modules/evidence/public';
import type { MasteryRepository, MasteryTrack } from '@/modules/mastery/public';
import type {
  AbilityCalibrationRepository,
  AbilityCalibrationSnapshot,
  AbilityChangeProjection,
  BaselineCoverageProjection,
  CapabilityCalibrationProjection,
  ModuleCalibrationProjection,
  ScoreForecastProjection
} from '../contracts/AbilityCalibrationRepository';
import {
  ABILITY_CALIBRATION_ALGORITHM_VERSION,
  BaselineCoverageStatus,
  ScoreForecastBasis
} from '../domain/CalibrationCodes';

const TRUE_CLASSES: ReadonlySet<ObjectiveEvidenceOriginCode> = new Set([
  ObjectiveEvidenceOrigin.OfficialTrue,
  ObjectiveEvidenceOrigin.ImportedTrue,
  ObjectiveEvidenceOrigin.UserTrue
]);
const TRAINING_CLASSES: ReadonlySet<ObjectiveEvidenceOriginCode> = new Set([
  ObjectiveEvidenceOrigin.DiagnosticAnchor,
  ObjectiveEvidenceOrigin.AiVariant,
  ObjectiveEvidenceOrigin.AiTraining,
  ObjectiveEvidenceOrigin.Unknown
]);

export class BuildAbilityCalibration {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: AbilityCalibrationRepository,
    private readonly candidates: CandidateRepository,
    private readonly curriculums: CurriculumRepository,
    private readonly evidence: LearningEvidenceRepository,
    private readonly mastery: MasteryRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: { readonly persist?: boolean } = {}): Promise<AbilityCalibrationSnapshot | undefined> {
    const cycle = await this.candidates.findCurrentCycle();
    if (!cycle) return undefined;
    const [curriculum, evidence, tracks, previous] = await Promise.all([
      this.curriculums.findBundle(cycle.examCycle.curriculumVersionId),
      this.evidence.listAllValid(cycle.examCycle.id),
      this.mastery.listAllTracks(cycle.examCycle.id),
      this.repository.findLatest(cycle.examCycle.id)
    ]);
    if (!curriculum) return undefined;
    const now = this.clock.now();
    const fingerprint = await sha256Json(toJson({
      algorithmVersion: ABILITY_CALIBRATION_ALGORITHM_VERSION,
      examCycleId: cycle.examCycle.id,
      curriculumVersionId: curriculum.curriculum.id,
      evidence: evidence.map((item) => [item.id, item.validationPolicyVersion, item.occurredAt]),
      tracks: tracks.map((item) => [item.id, item.version, item.updatedAt]),
      measurements: cycle.scoreMeasurements.map((item) => [item.id, item.measuredAt, item.confidence]),
      targets: cycle.scoreTargets.filter((item) => item.status === 'active').map((item) => [item.id, item.targetScore])
    }));
    const existing = await this.repository.findByFingerprint(fingerprint);
    if (existing) return existing;

    // Calibration models accuracy per capability, which only means anything for
    // subjects answered with questions. Which subjects those are belongs to the
    // exam package, not to this use case.
    const objectiveSubjects = objectiveSubjectsOf(curriculum);
    const trainable = curriculum.capabilityNodes.filter((node) => isTrainableObjective(node, objectiveSubjects));
    const moduleNodes = curriculum.capabilityNodes.filter((node) => (
      node.status === 'active' && objectiveSubjects.has(node.subject) && node.nodeType === 'module'
    ));
    const trackByCapability = new Map(tracks.map((track) => [track.capabilityNodeId, track]));
    const capabilities = trainable.map((node) => capabilityProjection(
      node,
      evidence.filter((item) => item.capabilityNodeId === node.id),
      now
    ));
    const modules = moduleNodes.map((moduleNode) => moduleProjection(
      moduleNode,
      capabilities.filter((item) => item.module === moduleNode.module),
      trainable.filter((node) => node.module === moduleNode.module).map((node) => trackByCapability.get(node.id)).filter(isTrack)
    ));
    const baseline = baselineProjection(moduleNodes, trainable, evidence, capabilities, now);
    const subjectByCapability = new Map(curriculum.capabilityNodes.map((node) => [node.id, node.subject]));
    const scoreForecasts = buildScoreForecasts(
      cycle.scoreTargets,
      cycle.scoreMeasurements,
      modules,
      baseline,
      evidence,
      subjectByCapability,
      objectiveSubjects,
      now
    );
    const changes = buildChanges(previous?.modules ?? [], modules);
    const snapshot: AbilityCalibrationSnapshot = {
      id: this.ids.next('AbilityCalibrationSnapshotId'),
      examCycleId: cycle.examCycle.id,
      algorithmVersion: ABILITY_CALIBRATION_ALGORITHM_VERSION,
      evidenceCutoffAt: evidence.reduce((latest, item) => item.occurredAt > latest ? item.occurredAt : latest, 0 as typeof now),
      inputFingerprint: fingerprint,
      baseline,
      capabilities,
      modules,
      scoreForecasts,
      changes,
      createdAt: now
    };
    if (command.persist === false) return snapshot;
    try {
      await this.unitOfWork.run((context) => this.repository.append(snapshot, context));
      return snapshot;
    } catch (error) {
      const concurrent = await this.repository.findByFingerprint(fingerprint);
      if (concurrent) return concurrent;
      throw error;
    }
  }
}

function capabilityProjection(
  node: CapabilityNode,
  evidence: readonly LearningEvidenceRecord[],
  now: number
): CapabilityCalibrationProjection {
  const correctness = evidence.filter((item) => item.evidenceType === 'correctness');
  const training = aggregate(correctness.filter((item) => TRAINING_CLASSES.has(calibrationClass(item))), now);
  const truth = aggregate(correctness.filter((item) => TRUE_CLASSES.has(calibrationClass(item))), now);
  const calibrated = blendCalibration(training, truth);
  return {
    capabilityNodeId: node.id,
    module: node.module,
    trainingAccuracy: training.present ? training.value : undefined,
    trueQuestionAccuracy: truth.present ? truth.value : undefined,
    calibratedAccuracy: calibrated.value,
    calibrationGap: training.present && truth.present ? round(truth.value - training.value) : undefined,
    trainingSample: training.sample,
    trueQuestionSample: truth.sample,
    confidence: calibrated.confidence
  };
}

function moduleProjection(
  node: CapabilityNode,
  capabilities: readonly CapabilityCalibrationProjection[],
  tracks: readonly MasteryTrack[]
): ModuleCalibrationProjection {
  const training = weightedCapabilityAverage(capabilities, 'trainingAccuracy', 'trainingSample');
  const truth = weightedCapabilityAverage(capabilities, 'trueQuestionAccuracy', 'trueQuestionSample');
  const calibrated = weightedCapabilityAverage(capabilities, 'calibratedAccuracy', 'confidence');
  return {
    module: node.module,
    name: node.name,
    scoreWeight: node.scoreWeight,
    trainingAccuracy: training.value,
    trueQuestionAccuracy: truth.value,
    calibratedAccuracy: calibrated.value,
    calibrationGap: training.value !== undefined && truth.value !== undefined ? round(truth.value - training.value) : undefined,
    trainingSample: round(capabilities.reduce((sum, item) => sum + item.trainingSample, 0)),
    trueQuestionSample: round(capabilities.reduce((sum, item) => sum + item.trueQuestionSample, 0)),
    speed: weightedTrackAverage(tracks, 'speed'),
    retention: weightedTrackAverage(tracks, 'retention'),
    transfer: weightedTrackAverage(tracks, 'transfer'),
    confidence: round(weightedCapabilityAverage(capabilities, 'confidence', 'confidence').value ?? 0)
  };
}

function baselineProjection(
  moduleNodes: readonly CapabilityNode[],
  trainable: readonly CapabilityNode[],
  evidence: readonly LearningEvidenceRecord[],
  capabilities: readonly CapabilityCalibrationProjection[],
  now: number
): BaselineCoverageProjection {
  const modules = moduleNodes.map((moduleNode) => {
    const capabilityIds = new Set(trainable.filter((node) => node.module === moduleNode.module).map((node) => node.id));
    const anchor = aggregate(evidence.filter((item) => (
      capabilityIds.has(item.capabilityNodeId)
      && item.evidenceType === 'correctness'
      && item.assessmentRole === AssessmentRole.Anchor
    )), now);
    const trueAnchor = aggregate(evidence.filter((item) => (
      capabilityIds.has(item.capabilityNodeId)
      && item.evidenceType === 'correctness'
      && item.assessmentRole === AssessmentRole.Anchor
      && TRUE_CLASSES.has(calibrationClass(item))
    )), now);
    const covered = trueAnchor.sample >= 1.5 || anchor.sample >= 2.5;
    return {
      module: moduleNode.module,
      name: moduleNode.name,
      anchorSample: anchor.sample,
      trueAnchorSample: trueAnchor.sample,
      covered,
      confidence: round(clamp(1 - Math.exp(-(anchor.sample + trueAnchor.sample * .7) / 4)))
    };
  });
  const covered = modules.filter((item) => item.covered);
  const anchorSample = round(modules.reduce((sum, item) => sum + item.anchorSample, 0));
  const trueAnchorSample = round(modules.reduce((sum, item) => sum + item.trueAnchorSample, 0));
  const coverageRatio = modules.length ? round(covered.length / modules.length) : 0;
  const confidence = round(modules.length ? modules.reduce((sum, item) => sum + item.confidence, 0) / modules.length : 0);
  const status = modules.length > 0 && covered.length === modules.length && anchorSample >= modules.length * 2.5 && confidence >= .45
    ? BaselineCoverageStatus.Sufficient
    : anchorSample > 0 ? BaselineCoverageStatus.InProgress : BaselineCoverageStatus.NotStarted;
  const nextModule = modules.filter((item) => !item.covered).sort((left, right) => left.anchorSample - right.anchorSample)[0];
  const nextCapability = nextModule
    ? capabilities.filter((item) => item.module === nextModule.module).sort((left, right) => (
        left.trainingSample + left.trueQuestionSample - right.trainingSample - right.trueQuestionSample
      ))[0]
    : undefined;
  return {
    status,
    requiredModuleCount: modules.length,
    coveredModuleCount: covered.length,
    coverageRatio,
    anchorSample,
    trueAnchorSample,
    confidence,
    modules,
    coveredModules: covered.map((item) => item.module),
    uncoveredModules: modules.filter((item) => !item.covered).map((item) => item.module),
    nextCapabilityNodeId: nextCapability?.capabilityNodeId,
    nextRecommendation: nextModule
      ? `下一轮优先补充${nextModule.name}锚定样本。`
      : status === BaselineCoverageStatus.Sufficient ? '模块基线已覆盖，后续用真题复测持续校准。' : '当前大纲没有可诊断模块。'
  };
}

function buildScoreForecasts(
  targets: readonly {
    readonly subject: string;
    readonly targetScore: number;
    readonly maxScore: number;
    readonly status: string;
  }[],
  measurements: readonly ScoreMeasurement[],
  modules: readonly ModuleCalibrationProjection[],
  baseline: BaselineCoverageProjection,
  evidence: readonly LearningEvidenceRecord[],
  subjectByCapability: ReadonlyMap<string, string>,
  objectiveSubjects: ReadonlySet<string>,
  now: number
): ScoreForecastProjection[] {
  return targets.filter((target) => target.status === 'active').map((target) => {
    const measurement = latestMeasurement(measurements, target.subject);
    // A subject answered in writing is forecast from rubric evidence; module
    // accuracy has nothing to say about it.
    if (!objectiveSubjects.has(target.subject)) {
      const subjectiveEvidence = evidence.filter((item) => (
        subjectByCapability.get(item.capabilityNodeId) === target.subject
        && item.metadata.evidenceKind === 'subjective_rubric'
      ));
      return subjectiveEvidenceForecast(target, measurement, subjectiveEvidence, now);
    }
    const available = modules.filter((item) => item.calibratedAccuracy !== undefined);
    const totalModuleWeight = modules.reduce((sum, item) => sum + item.scoreWeight, 0) || 1;
    const evidenceWeight = available.reduce((sum, item) => sum + item.scoreWeight, 0);
    const evidenceScore = evidenceWeight > 0
      ? available.reduce((sum, item) => sum + item.calibratedAccuracy! * item.scoreWeight, 0) / evidenceWeight * target.maxScore
      : undefined;
    const evidenceConfidence = evidenceWeight > 0
      ? clamp(available.reduce((sum, item) => sum + item.confidence * item.scoreWeight, 0) / evidenceWeight) * (evidenceWeight / totalModuleWeight)
      : 0;
    const measuredNormalized = measurement ? measurement.score / measurement.maxScore * target.maxScore : undefined;
    const measurementConfidence = measurement?.confidence ?? 0;
    const denominator = evidenceConfidence + measurementConfidence;
    const center = evidenceScore !== undefined && measuredNormalized !== undefined && denominator > 0
      ? (evidenceScore * evidenceConfidence + measuredNormalized * measurementConfidence) / denominator
      : evidenceScore ?? measuredNormalized;
    const confidence = clamp(1 - (1 - evidenceConfidence) * (1 - measurementConfidence * .7));
    const trueSample = modules.reduce((sum, item) => sum + item.trueQuestionSample, 0);
    const basis = evidenceScore === undefined
      ? measurementBasis(measurement)
      : trueSample >= 3
        ? measuredNormalized === undefined ? ScoreForecastBasis.TrueQuestionCalibrated : ScoreForecastBasis.Blended
        : measuredNormalized === undefined ? ScoreForecastBasis.TrainingEvidence : ScoreForecastBasis.Blended;
    return forecast(target, center, confidence, baseline.coverageRatio, basis, forecastExplanation(basis, trueSample, baseline));
  });
}

function subjectiveEvidenceForecast(
  target: { readonly subject: string; readonly targetScore: number; readonly maxScore: number },
  measurement: ScoreMeasurement | undefined,
  evidence: readonly LearningEvidenceRecord[],
  now: number
): ScoreForecastProjection {
  const assessment = aggregate(evidence, now);
  if (!assessment.present) return measurementForecast(target, measurement);
  const evidenceScore = assessment.value * target.maxScore;
  const evidenceConfidence = clamp((1 - Math.exp(-assessment.sample / 10)) * .85);
  const measuredScore = measurement ? measurement.score / measurement.maxScore * target.maxScore : undefined;
  const measurementConfidence = measurement?.confidence ?? 0;
  const denominator = evidenceConfidence + measurementConfidence;
  const center = measuredScore === undefined || denominator <= 0
    ? evidenceScore
    : (evidenceScore * evidenceConfidence + measuredScore * measurementConfidence) / denominator;
  const confidence = clamp(1 - (1 - evidenceConfidence) * (1 - measurementConfidence * .7));
  const coverageRatio = clamp(assessment.sample / 20);
  const basis = measuredScore === undefined ? ScoreForecastBasis.TrainingEvidence : ScoreForecastBasis.Blended;
  const explanation = `预测已参考申论批改维度证据；当前有效维度样本 ${round(assessment.sample)}。`;
  return forecast(target, center, confidence, coverageRatio, basis, explanation);
}

function measurementForecast(
  target: { readonly subject: string; readonly targetScore: number; readonly maxScore: number },
  measurement: ScoreMeasurement | undefined
): ScoreForecastProjection {
  const center = measurement ? measurement.score / measurement.maxScore * target.maxScore : undefined;
  return forecast(
    target,
    center,
    measurement?.confidence ?? 0,
    measurement ? .2 : 0,
    measurementBasis(measurement),
    measurement ? '当前缺少该科目的结构化能力证据，区间主要由最近成绩及其可信度支撑。' : '当前没有足够数据生成分数区间。'
  );
}

function forecast(
  target: { readonly subject: string; readonly targetScore: number; readonly maxScore: number },
  center: number | undefined,
  confidence: number,
  coverageRatio: number,
  basis: ScoreForecastProjection['basis'],
  explanation: string
): ScoreForecastProjection {
  if (center === undefined) {
    return {
      subject: target.subject as ScoreForecastProjection['subject'],
      maxScore: target.maxScore,
      targetScore: target.targetScore,
      confidence: 0,
      coverageRatio,
      basis,
      explanation
    };
  }
  const halfWidth = Math.max(
    target.maxScore * .04,
    target.maxScore * (.2 * (1 - confidence) + .08 * (1 - coverageRatio))
  );
  const low = roundScore(Math.max(0, center - halfWidth));
  const high = roundScore(Math.min(target.maxScore, center + halfWidth));
  return {
    subject: target.subject as ScoreForecastProjection['subject'],
    low,
    center: roundScore(center),
    high,
    maxScore: target.maxScore,
    targetScore: target.targetScore,
    targetGapLow: roundScore(target.targetScore - high),
    targetGapHigh: roundScore(target.targetScore - low),
    confidence: round(confidence),
    coverageRatio: round(coverageRatio),
    basis,
    explanation
  };
}

function buildChanges(
  previous: readonly ModuleCalibrationProjection[],
  current: readonly ModuleCalibrationProjection[]
): AbilityChangeProjection[] {
  const before = new Map(previous.map((item) => [item.module, item]));
  return current.flatMap((item) => {
    const old = before.get(item.module);
    if (!old) return [];
    return [{
      module: item.module,
      trainingAccuracyDelta: delta(item.trainingAccuracy, old.trainingAccuracy),
      trueQuestionAccuracyDelta: delta(item.trueQuestionAccuracy, old.trueQuestionAccuracy),
      calibratedAccuracyDelta: delta(item.calibratedAccuracy, old.calibratedAccuracy),
      speedDelta: delta(item.speed, old.speed),
      retentionDelta: delta(item.retention, old.retention),
      transferDelta: delta(item.transfer, old.transfer),
      targetScoreContribution: item.calibratedAccuracy !== undefined && old.calibratedAccuracy !== undefined
        ? round((item.calibratedAccuracy - old.calibratedAccuracy) * item.scoreWeight * 100)
        : undefined
    }];
  });
}

function calibrationClass(item: LearningEvidenceRecord): ObjectiveEvidenceOriginCode {
  return objectiveEvidenceOriginFrom(item.metadata.questionOriginType);
}

function aggregate(values: readonly LearningEvidenceRecord[], now: number) {
  let total = 0;
  let weight = 0;
  for (const item of values) {
    if (item.value === undefined) continue;
    const ageDays = Math.max(0, now - Number(item.occurredAt)) / 86_400_000;
    const legacySourceFactor = item.validationPolicyVersion === 'aptitude-objective:v1'
      ? objectiveEvidenceOriginReliability(calibrationClass(item))
      : 1;
    const current = item.weight * item.quality * legacySourceFactor * Math.pow(.5, ageDays / 90);
    total += clamp(item.value) * current;
    weight += current;
  }
  return { value: weight ? round(total / weight) : 0, sample: round(weight), present: weight > 0 };
}

function blendCalibration(training: ReturnType<typeof aggregate>, truth: ReturnType<typeof aggregate>) {
  if (!training.present && !truth.present) return { value: undefined, confidence: 0 };
  const trueShare = truth.present
    ? Math.min(.8, .45 + truth.sample / (truth.sample + training.sample + 1) * .35)
    : 0;
  const value = truth.present && training.present
    ? truth.value * trueShare + training.value * (1 - trueShare)
    : truth.present ? truth.value : training.value;
  const sample = training.sample * .6 + truth.sample;
  return {
    value: round(value),
    confidence: round(clamp((1 - Math.exp(-sample / 6)) * (truth.present ? 1 : .72)))
  };
}

function weightedCapabilityAverage(
  items: readonly CapabilityCalibrationProjection[],
  valueKey: 'trainingAccuracy' | 'trueQuestionAccuracy' | 'calibratedAccuracy' | 'confidence',
  weightKey: 'trainingSample' | 'trueQuestionSample' | 'confidence'
) {
  const available = items.filter((item) => item[valueKey] !== undefined);
  const weight = available.reduce((sum, item) => sum + Math.max(.05, item[weightKey]), 0);
  return {
    value: weight
      ? round(available.reduce((sum, item) => (
          sum + item[valueKey]! * Math.max(.05, item[weightKey])
        ), 0) / weight)
      : undefined
  };
}

function weightedTrackAverage(tracks: readonly MasteryTrack[], key: 'speed' | 'retention' | 'transfer') {
  const weight = tracks.reduce((sum, item) => sum + Math.max(.1, item.effectiveSample), 0);
  return weight
    ? round(tracks.reduce((sum, item) => (
        sum + item[key] * Math.max(.1, item.effectiveSample)
      ), 0) / weight)
    : 0;
}

function latestMeasurement(values: readonly ScoreMeasurement[], subject: string) {
  return values.filter((item) => item.subject === subject)
    .sort((left, right) => right.measuredAt - left.measuredAt)[0];
}

function measurementBasis(value: ScoreMeasurement | undefined) {
  if (!value) return ScoreForecastBasis.Missing;
  return value.measurementType === ScoreMeasurementType.SelfReport
    ? ScoreForecastBasis.SelfReport
    : ScoreForecastBasis.Measured;
}

function forecastExplanation(
  basis: ScoreForecastProjection['basis'],
  trueSample: number,
  baseline: BaselineCoverageProjection
) {
  if (basis === ScoreForecastBasis.TrueQuestionCalibrated
    || (basis === ScoreForecastBasis.Blended && trueSample >= 3)) {
    return `区间已参考真题证据；当前覆盖 ${baseline.coveredModuleCount}/${baseline.requiredModuleCount} 个模块。`;
  }
  if (basis === ScoreForecastBasis.TrainingEvidence || basis === ScoreForecastBasis.Blended) {
    return `区间主要由训练证据支撑；真题校准样本 ${round(trueSample)}，覆盖 ${baseline.coveredModuleCount}/${baseline.requiredModuleCount} 个模块。`;
  }
  return '区间主要由最近测量支撑，随着模块锚定和真题复测会逐步收窄。';
}

/** Subject codes this package answers with questions. */
function objectiveSubjectsOf(curriculum: CurriculumBundle): ReadonlySet<string> {
  return new Set(
    projectExamSubjects(curriculum)
      .filter((subject) => subject.deliveryKind === ExamDeliveryKind.Objective)
      .map((subject) => subject.code as string)
  );
}

function isTrainableObjective(node: CapabilityNode, objectiveSubjects: ReadonlySet<string>) {
  return node.status === 'active'
    && objectiveSubjects.has(node.subject)
    && (node.nodeType === 'knowledge_point' || node.nodeType === 'sub_point');
}

function isTrack(value: MasteryTrack | undefined): value is MasteryTrack { return Boolean(value); }
function delta(value: number | undefined, previous: number | undefined) {
  return value === undefined || previous === undefined ? undefined : round(value - previous);
}
function clamp(value: number) { return Math.max(0, Math.min(1, value)); }
function round(value: number) { return Math.round(value * 10_000) / 10_000; }
function roundScore(value: number) { return Math.round(value * 10) / 10; }
function toJson(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }
