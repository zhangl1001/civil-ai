import type { TransactionContext } from '@/capabilities/database/public';
import type { CapabilityNodeId, ErrorDiagnosisId, EvidenceId, ExamCycleId, LearningSessionId, QuestionSetId } from '@/kernel/public';
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
  listByQuestionSet(questionSetId: QuestionSetId, limit: number): Promise<readonly ObjectiveSessionFacts[]>;
  listRecent(examCycleId: ExamCycleId, limit: number, offset?: number): Promise<readonly ObjectiveSessionFacts[]>;
  listAll(examCycleId: ExamCycleId): Promise<readonly ObjectiveSessionFacts[]>;
}

export interface ErrorDiagnosisRepository {
  append(diagnoses: readonly ErrorDiagnosisRecord[], context: TransactionContext): Promise<void>;
  listBySession(sessionId: LearningSessionId): Promise<readonly ErrorDiagnosisRecord[]>;
  listBySessions(sessionIds: readonly LearningSessionId[]): Promise<readonly ErrorDiagnosisRecord[]>;
  find(diagnosisId: ErrorDiagnosisId): Promise<ErrorDiagnosisRecord | undefined>;
  findMany(diagnosisIds: readonly ErrorDiagnosisId[]): Promise<readonly ErrorDiagnosisRecord[]>;
  findByIdempotencyKey(idempotencyKey: string): Promise<ErrorDiagnosisRecord | undefined>;
  findByIdempotencyKeys(idempotencyKeys: readonly string[]): Promise<readonly ErrorDiagnosisRecord[]>;
  appendConfirmation(
    confirmation: ErrorDiagnosisConfirmationRecord,
    nextProjection: ErrorDiagnosisCurrentProjection,
    expectedProjectionVersion: number | undefined,
    context: TransactionContext
  ): Promise<void>;
  findConfirmationByIdempotencyKey(idempotencyKey: string): Promise<ErrorDiagnosisConfirmationRecord | undefined>;
  findCurrentProjection(diagnosisId: ErrorDiagnosisId): Promise<ErrorDiagnosisCurrentProjection | undefined>;
  listCurrentProjections(diagnosisIds: readonly ErrorDiagnosisId[]): Promise<readonly ErrorDiagnosisCurrentProjection[]>;
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
  listAllValid(examCycleId: ExamCycleId): Promise<readonly LearningEvidenceRecord[]>;
}
