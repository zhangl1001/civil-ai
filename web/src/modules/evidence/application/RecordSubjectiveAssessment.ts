import type { UnitOfWork } from '@/capabilities/database/public';
import {
  AssessmentRole,
  type CapabilityNodeId,
  type Clock,
  type ExamCycleId,
  type IdGenerator,
  type JsonObject
} from '@/kernel/public';
import type { LearningEvidenceRecord } from '../contracts/LearningFacts';
import type { LearningEvidenceRepository } from '../contracts/LearningRepositories';
import { EvidenceSource, EvidenceType } from '../domain/EvidenceCodes';

export interface SubjectiveAssessmentDimension {
  readonly capabilityNodeId: CapabilityNodeId;
  /** Stable rubric dimension identity, independent from the broader capability node. */
  readonly dimensionKey: string;
  readonly score: number;
  readonly confidence: number;
  readonly metadata: JsonObject;
}

export interface RecordSubjectiveAssessmentCommand {
  readonly examCycleId: ExamCycleId;
  readonly sourceAssetId: string;
  readonly rubricVersion: string;
  readonly dimensions: readonly SubjectiveAssessmentDimension[];
}

export interface SubjectiveAssessmentMasteryRefresher {
  execute(command: {
    readonly examCycleId: ExamCycleId;
    readonly capabilityNodeId: CapabilityNodeId;
  }): Promise<unknown>;
}

export class RecordSubjectiveAssessment {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: LearningEvidenceRepository,
    private readonly refreshMastery: SubjectiveAssessmentMasteryRefresher,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: RecordSubjectiveAssessmentCommand): Promise<readonly LearningEvidenceRecord[]> {
    const now = this.clock.now();
    const evidence: LearningEvidenceRecord[] = [];
    const fresh: LearningEvidenceRecord[] = [];
    for (const dimension of command.dimensions) {
      if (!dimension.dimensionKey.trim()) throw new Error('Subjective assessment dimension key is required');
      const idempotencyKey = `subjective:${command.sourceAssetId}:${dimension.capabilityNodeId}:${dimension.dimensionKey}:${command.rubricVersion}`;
      const existing = await this.repository.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        evidence.push(existing);
        continue;
      }
      const confidence = clamp01(dimension.confidence);
      const record: LearningEvidenceRecord = {
        id: this.ids.next('EvidenceId'),
        examCycleId: command.examCycleId,
        capabilityNodeId: dimension.capabilityNodeId,
        assessmentRole: AssessmentRole.Practice,
        evidenceType: EvidenceType.Correctness,
        value: clamp01(dimension.score),
        weight: 1,
        quality: Math.max(0.4, confidence),
        source: EvidenceSource.AiGrader,
        validationPolicyVersion: command.rubricVersion,
        occurredAt: now,
        idempotencyKey,
        metadata: {
          ...dimension.metadata,
          evidenceKind: 'subjective_rubric',
          dimensionKey: dimension.dimensionKey,
          sourceAssetId: command.sourceAssetId,
          rubricVersion: command.rubricVersion
        }
      };
      evidence.push(record);
      fresh.push(record);
    }
    if (fresh.length) {
      await this.unitOfWork.run((context) => this.repository.append(
        fresh,
        fresh.map((item) => ({
          evidenceId: item.id,
          validityStatus: 'valid',
          updatedAt: now,
          version: 1
        })),
        context
      ));
    }
    for (const capabilityNodeId of new Set(evidence.map((item) => item.capabilityNodeId))) {
      await this.refreshMastery.execute({ examCycleId: command.examCycleId, capabilityNodeId });
    }
    return evidence;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
