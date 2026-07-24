import type { TransactionContext } from '@/capabilities/database/public';
import type { CapabilityNodeId, ErrorDiagnosisId, EvidenceId, ExamCycleId, LearningSessionId } from '@/kernel/public';
import type {
  ErrorDiagnosisRecord,
  ErrorDiagnosisConfirmationRecord,
  ErrorDiagnosisCurrentProjection,
  EvidenceCorrectionRecord,
  EvidenceValidityProjection,
  LearningEvidenceRecord,
  ObjectiveSessionFacts
} from './LearningFacts';

export interface LearningSessionRepository {
  commitObjectiveSession(facts: ObjectiveSessionFacts, context: TransactionContext): Promise<void>;
  findByIdempotencyKey(idempotencyKey: string): Promise<ObjectiveSessionFacts | undefined>;
  findById(sessionId: LearningSessionId): Promise<ObjectiveSessionFacts | undefined>;
  listRecent(examCycleId: ExamCycleId, limit: number): Promise<readonly ObjectiveSessionFacts[]>;
}

export interface ErrorDiagnosisRepository {
  append(diagnoses: readonly ErrorDiagnosisRecord[], context: TransactionContext): Promise<void>;
  listBySession(sessionId: LearningSessionId): Promise<readonly ErrorDiagnosisRecord[]>;
  find(diagnosisId: ErrorDiagnosisId): Promise<ErrorDiagnosisRecord | undefined>;
  findByIdempotencyKey(idempotencyKey: string): Promise<ErrorDiagnosisRecord | undefined>;
  appendConfirmation(
    confirmation: ErrorDiagnosisConfirmationRecord,
    nextProjection: ErrorDiagnosisCurrentProjection,
    expectedProjectionVersion: number | undefined,
    context: TransactionContext
  ): Promise<void>;
  findConfirmationByIdempotencyKey(idempotencyKey: string): Promise<ErrorDiagnosisConfirmationRecord | undefined>;
  findCurrentProjection(diagnosisId: ErrorDiagnosisId): Promise<ErrorDiagnosisCurrentProjection | undefined>;
}

export interface LearningEvidenceRepository {
  append(
    evidence: readonly LearningEvidenceRecord[],
    validity: readonly EvidenceValidityProjection[],
    context: TransactionContext
  ): Promise<void>;
  appendCorrection(
    correction: EvidenceCorrectionRecord,
    nextValidity: EvidenceValidityProjection,
    expectedProjectionVersion: number,
    context: TransactionContext
  ): Promise<void>;
  find(evidenceId: EvidenceId): Promise<LearningEvidenceRecord | undefined>;
  findValidity(evidenceId: EvidenceId): Promise<EvidenceValidityProjection | undefined>;
  findByIdempotencyKey(idempotencyKey: string): Promise<LearningEvidenceRecord | undefined>;
  findCorrectionByIdempotencyKey(idempotencyKey: string): Promise<EvidenceCorrectionRecord | undefined>;
  listValid(
    examCycleId: ExamCycleId,
    capabilityNodeId: CapabilityNodeId,
    limit: number
  ): Promise<readonly LearningEvidenceRecord[]>;
}
