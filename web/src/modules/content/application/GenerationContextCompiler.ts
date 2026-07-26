import type { CandidateRepository, ScoreMeasurement } from '@/modules/candidate/public';
import { ScoreMeasurementType, ScoreTargetStatus } from '@/modules/candidate/public';
import type { CapabilityNode, CurriculumRepository } from '@/modules/curriculum/public';
import type { AssessmentRole, CapabilityNodeId, ExamCycleId, JsonObject, SubjectCode } from '@/kernel/public';

export const GenerationEvidenceLevel = {
  Missing: 'missing',
  SelfReported: 'self_reported',
  MeasuredLowConfidence: 'measured_low_confidence',
  Measured: 'measured'
} as const;

export type GenerationEvidenceLevel = typeof GenerationEvidenceLevel[keyof typeof GenerationEvidenceLevel];

export interface GenerationContextRequest {
  readonly examCycleId: ExamCycleId;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly assessmentRole: AssessmentRole;
  readonly requestedCount: number;
  readonly difficultyMin: number;
  readonly difficultyMax: number;
}

export interface CompiledGenerationContext {
  readonly snapshot: JsonObject;
  readonly capability: CapabilityNode;
}

export interface GenerationLearningContextPort {
  build(examCycleId: ExamCycleId, capabilityNodeId: CapabilityNodeId): Promise<JsonObject>;
}

export class GenerationContextCompiler {
  constructor(
    private readonly candidateRepository: CandidateRepository,
    private readonly curriculumRepository: CurriculumRepository,
    private readonly learningContext?: GenerationLearningContextPort
  ) {}

  async compile(request: GenerationContextRequest): Promise<CompiledGenerationContext> {
    assertRequest(request);
    const cycle = await this.candidateRepository.findCycle(request.examCycleId);
    if (!cycle) throw new Error(`Exam cycle does not exist: ${request.examCycleId}`);
    const curriculum = await this.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId);
    if (!curriculum) throw new Error(`Curriculum does not exist: ${cycle.examCycle.curriculumVersionId}`);
    const capability = curriculum.capabilityNodes.find((node) => node.id === request.capabilityNodeId);
    if (!capability || capability.status !== 'active') {
      throw new Error(`Active capability does not exist in bound curriculum: ${request.capabilityNodeId}`);
    }
    const target = cycle.scoreTargets.find((item) => (
      item.subject === capability.subject && item.status === ScoreTargetStatus.Active
    ));
    const measurement = latestMeasurement(cycle.scoreMeasurements, capability.subject, capability.module);
    const prerequisiteIds = curriculum.capabilityEdges
      .filter((edge) => edge.toNodeId === capability.id && edge.relationType === 'prerequisite')
      .map((edge) => edge.fromNodeId);
    const relatedIds = curriculum.capabilityEdges
      .filter((edge) => edge.fromNodeId === capability.id && (edge.relationType === 'related' || edge.relationType === 'transfer'))
      .map((edge) => edge.toNodeId);
    const nodesById = new Map(curriculum.capabilityNodes.map((node) => [node.id, node]));
    const evidenceLevel = resolveEvidenceLevel(measurement);
    const learningEvidence = await this.learningContext?.build(request.examCycleId, capability.id) ?? {
      hasMasteryProjection: false,
      recentErrors: [],
      recentSessions: []
    };
    const snapshot: JsonObject = {
      schemaVersion: 'generation-context.v1',
      examCycle: {
        id: cycle.examCycle.id,
        examType: cycle.examCycle.examType,
        examName: cycle.examCycle.examName ?? cycle.examCycle.examType,
        examDate: cycle.examCycle.examDate,
        phase: cycle.examCycle.phase,
        timeZone: cycle.examCycle.timeZone,
        curriculumVersionId: cycle.examCycle.curriculumVersionId
      },
      target: {
        subject: capability.subject,
        targetScore: target?.targetScore ?? null,
        maxScore: target?.maxScore ?? null,
        currentScore: measurement?.score ?? null,
        scoreGap: target && measurement ? round(target.targetScore - measurement.score) : null,
        evidenceLevel,
        evidenceConfidence: measurement?.confidence ?? 0,
        measurementType: measurement?.measurementType ?? null,
        measuredAt: measurement?.measuredAt ?? null
      },
      capability: {
        id: capability.id,
        code: capability.code,
        name: capability.name,
        nodeType: capability.nodeType,
        subject: capability.subject,
        module: capability.module,
        targetAccuracy: capability.defaultTargetAccuracy ?? null,
        targetSeconds: capability.defaultTargetSeconds ?? null,
        prerequisites: prerequisiteIds.map((id) => capabilitySummary(nodesById.get(id))),
        related: relatedIds.map((id) => capabilitySummary(nodesById.get(id)))
      },
      learningConstraints: {
        studyMode: cycle.studyConstraints.studyMode,
        weekdayMinutes: cycle.studyConstraints.weekdayMinutes,
        weekendMinutes: cycle.studyConstraints.weekendMinutes,
        maxFocusMinutes: cycle.studyConstraints.maxFocusMinutes ?? null
      },
      teachingPreferences: {
        teachingOrder: cycle.learningPreferences.teachingOrder,
        explanationDepth: cycle.learningPreferences.explanationDepth,
        companionTone: cycle.learningPreferences.companionTone
      },
      generationRequest: {
        assessmentRole: request.assessmentRole,
        requestedCount: request.requestedCount,
        difficultyMin: request.difficultyMin,
        difficultyMax: request.difficultyMax
      },
      learningEvidence
    };
    return { snapshot, capability };
  }
}

function latestMeasurement(
  measurements: readonly ScoreMeasurement[],
  subject: SubjectCode,
  module: string
): ScoreMeasurement | undefined {
  return measurements
    .filter((measurement) => measurement.subject === subject && (!measurement.module || measurement.module === module))
    .reduce<ScoreMeasurement | undefined>((latest, measurement) => (
      !latest || measurement.measuredAt > latest.measuredAt ? measurement : latest
    ), undefined);
}

function resolveEvidenceLevel(measurement?: ScoreMeasurement): GenerationEvidenceLevel {
  if (!measurement) return GenerationEvidenceLevel.Missing;
  if (measurement.measurementType === ScoreMeasurementType.SelfReport) return GenerationEvidenceLevel.SelfReported;
  return measurement.confidence >= 0.6 ? GenerationEvidenceLevel.Measured : GenerationEvidenceLevel.MeasuredLowConfidence;
}

function capabilitySummary(node?: CapabilityNode): JsonObject {
  if (!node) throw new Error('Curriculum capability edge references a missing node');
  return { id: node.id, code: node.code, name: node.name, nodeType: node.nodeType };
}

function assertRequest(request: GenerationContextRequest): void {
  if (!Number.isInteger(request.requestedCount) || request.requestedCount < 1 || request.requestedCount > 25) {
    throw new RangeError('Requested question count must be an integer between 1 and 25');
  }
  if (
    !Number.isFinite(request.difficultyMin)
    || !Number.isFinite(request.difficultyMax)
    || request.difficultyMin < 0
    || request.difficultyMax > 1
    || request.difficultyMin > request.difficultyMax
  ) throw new RangeError('Difficulty range must satisfy 0 <= min <= max <= 1');
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
