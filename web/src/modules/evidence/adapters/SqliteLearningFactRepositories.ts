import type {
  SqlBatchStatement,
  SqlDatabase,
  SqlRow,
  SqlTransaction
} from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type {
  AttemptId, CapabilityNodeId, DecisionObservationId, ErrorDiagnosisConfirmationId, ErrorDiagnosisId, EvidenceCorrectionId,
  EvidenceId, ExamCycleId, GradingResultId, InstantMs, JsonObject, LearningSessionId,
  LearningThreadId, QuestionExposureId, QuestionId, QuestionSetId, ReviewQueueItemId
} from '@/kernel/public';
import type {
  ErrorDiagnosisRepository,
  LearningEvidenceRepository,
  LearningSessionRepository
} from '../contracts/LearningRepositories';
import type {
  AttemptRecord,
  DecisionObservationRecord,
  ErrorDiagnosisConfirmationRecord,
  ErrorDiagnosisCurrentProjection,
  ErrorCorrectionPlan,
  ErrorDiagnosisDimension,
  ErrorDiagnosisRecord,
  EvidenceCorrectionRecord,
  EvidenceValidityProjection,
  GradingResultRecord,
  LearningEvidenceRecord,
  LearningSessionRecord,
  ObjectiveSessionFacts,
  QuestionExposureRecord
} from '../contracts/LearningFacts';
import type { AssessmentRole } from '../domain/AssessmentRole';
import type { EvidenceValidity } from '../domain/EvidenceValidity';
import type {
  AttemptResult, ConfirmationStatus, ErrorCauseCode, ErrorDiagnosisConfirmationAction, EvidenceSource, EvidenceType,
  GradingMethod, LearningSessionStatus, LearningSessionType, QuestionExposureType
} from '../domain/EvidenceCodes';
import {
  ErrorDiagnosisDimensionCode,
  ErrorDiagnosisDimensionStatus,
  isDecisionObservationType
} from '../domain/EvidenceCodes';

interface SessionRow extends SqlRow {
  id: string; exam_cycle_id: string; learning_thread_id: string; question_set_id: string; review_queue_item_id: string | null;
  session_type: LearningSessionType; assessment_role: AssessmentRole; status: LearningSessionStatus;
  started_at: number; completed_at: number; elapsed_ms: number; question_count: number;
  answered_count: number; correct_count: number; idempotency_key: string; version: number;
  created_at: number; updated_at: number;
}
interface ExposureRow extends SqlRow {
  id: string; exam_cycle_id: string; learning_thread_id: string; session_id: string; question_id: string;
  exposure_type: QuestionExposureType; answer_exposed: number; occurred_at: number; idempotency_key: string;
}
interface AttemptRow extends SqlRow {
  id: string; session_id: string; question_id: string; exam_cycle_id: string; capability_node_id: string;
  learning_thread_id: string; assessment_role: AssessmentRole; question_content_version: number;
  answer_json: string; result: AttemptResult; score: number; elapsed_ms: number | null;
  confidence: number | null; hint_level: number; answer_change_count: number; submitted_at: number; idempotency_key: string;
}
interface ObservationRow extends SqlRow {
  id: string; attempt_id: string; observation_type: string; value_code: string; value_json: string;
  source: DecisionObservationRecord['source']; confidence: number; occurred_at: number;
}
interface GradingRow extends SqlRow {
  id: string; attempt_id: string; grading_method: GradingMethod; grader_version: string;
  result: AttemptResult; score: number; normalized_feedback_json: string; raw_response_json: string | null;
  confidence: number; confirmation_status: ConfirmationStatus; created_at: number; idempotency_key: string;
}
interface DiagnosisRow extends SqlRow {
  id: string; session_id: string; grading_result_id: string; attempt_id: string; exam_cycle_id: string; capability_node_id: string;
  cause_code: ErrorCauseCode; error_stage: string | null; detail: string; confidence: number;
  confirmation_status: Exclude<ConfirmationStatus, 'not_required'>; prerequisite_capability_node_id: string | null;
  recommended_action_code: string; dimensions_json: string; correction_plan_json: string;
  source: ErrorDiagnosisRecord['source']; created_at: number; idempotency_key: string;
}
interface DiagnosisConfirmationRow extends SqlRow {
  id: string; error_diagnosis_id: string; attempt_id: string; exam_cycle_id: string;
  action: ErrorDiagnosisConfirmationAction; corrected_cause_code: ErrorCauseCode | null;
  corrected_detail: string | null; actor_type: ErrorDiagnosisConfirmationRecord['actorType'];
  created_at: number; idempotency_key: string;
}
interface DiagnosisProjectionRow extends SqlRow {
  error_diagnosis_id: string; latest_confirmation_id: string;
  confirmation_status: ErrorDiagnosisCurrentProjection['confirmationStatus'];
  effective_cause_code: ErrorCauseCode; effective_detail: string; updated_at: number; version: number;
}
interface EvidenceRow extends SqlRow {
  id: string; exam_cycle_id: string; capability_node_id: string; attempt_id: string | null;
  assessment_role: AssessmentRole; evidence_type: EvidenceType; value: number | null; weight: number;
  quality: number; source: EvidenceSource; validation_policy_version: string; occurred_at: number;
  idempotency_key: string; metadata_json: string;
}
interface ValidityRow extends SqlRow {
  evidence_id: string; validity_status: EvidenceValidity; latest_correction_id: string | null;
  updated_at: number; version: number;
}
interface CorrectionRow extends SqlRow {
  id: string; exam_cycle_id: string; evidence_id: string; action: EvidenceCorrectionRecord['action'];
  reason_code: string; reason_detail: string | null; replacement_evidence_id: string | null;
  actor_type: EvidenceCorrectionRecord['actorType']; created_at: number; idempotency_key: string;
}

export class SqliteLearningSessionRepository implements LearningSessionRepository {
  constructor(private readonly database: SqlDatabase, private readonly transactionScope: SqlTransactionScope) {}

  async commitObjectiveSession(facts: ObjectiveSessionFacts, context: TransactionContext): Promise<void> {
    const transaction = this.transactionScope.resolve(context);
    await runBatch(transaction, [
      sessionStatement(facts.session),
      ...facts.exposures.map(exposureStatement),
      ...facts.attempts.map(attemptStatement),
      ...facts.observations.map(observationStatement),
      ...facts.gradings.map(gradingStatement)
    ]);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<ObjectiveSessionFacts | undefined> {
    const rows = await this.database.query<SessionRow>(
      'SELECT * FROM learning_sessions WHERE idempotency_key = ? LIMIT 1', [idempotencyKey]
    );
    return rows[0] ? this.load(rows[0]) : undefined;
  }

  async findById(sessionId: LearningSessionId): Promise<ObjectiveSessionFacts | undefined> {
    const rows = await this.database.query<SessionRow>('SELECT * FROM learning_sessions WHERE id = ? LIMIT 1', [sessionId]);
    return rows[0] ? this.load(rows[0]) : undefined;
  }

  async listByQuestionSet(questionSetId: QuestionSetId, limit: number): Promise<readonly ObjectiveSessionFacts[]> {
    assertLimit(limit);
    const rows = await this.database.query<SessionRow>(
      `SELECT * FROM learning_sessions
       WHERE question_set_id = ?
       ORDER BY completed_at DESC, id DESC
       LIMIT ?`,
      [questionSetId, limit]
    );
    return Promise.all(rows.map((row) => this.load(row)));
  }

  async listRecent(examCycleId: ExamCycleId, limit: number): Promise<readonly ObjectiveSessionFacts[]> {
    assertLimit(limit);
    const rows = await this.database.query<SessionRow>(
      `SELECT * FROM learning_sessions
       WHERE exam_cycle_id = ?
       ORDER BY started_at DESC, id DESC
       LIMIT ?`,
      [examCycleId, limit]
    );
    return Promise.all(rows.map((row) => this.load(row)));
  }

  async listAll(examCycleId: ExamCycleId): Promise<readonly ObjectiveSessionFacts[]> {
    const rows = await this.database.query<SessionRow>(
      `SELECT * FROM learning_sessions
       WHERE exam_cycle_id = ?
       ORDER BY started_at DESC, id DESC`,
      [examCycleId]
    );
    return Promise.all(rows.map((row) => this.load(row)));
  }

  private async load(row: SessionRow): Promise<ObjectiveSessionFacts> {
    const [exposures, attempts, observations, gradings] = await Promise.all([
      this.database.query<ExposureRow>('SELECT * FROM question_exposures WHERE session_id = ? ORDER BY occurred_at, id', [row.id]),
      this.database.query<AttemptRow>('SELECT * FROM attempts WHERE session_id = ? ORDER BY submitted_at, id', [row.id]),
      this.database.query<ObservationRow>(
        `SELECT observation.* FROM decision_observations observation
         JOIN attempts attempt ON attempt.id = observation.attempt_id
         WHERE attempt.session_id = ? ORDER BY observation.occurred_at, observation.id`, [row.id]
      ),
      this.database.query<GradingRow>(
        `SELECT grading.* FROM grading_results grading
         JOIN attempts attempt ON attempt.id = grading.attempt_id
         WHERE attempt.session_id = ? ORDER BY grading.created_at, grading.id`, [row.id]
      )
    ]);
    return {
      session: mapSession(row), exposures: exposures.map(mapExposure), attempts: attempts.map(mapAttempt),
      observations: observations.map(mapObservation), gradings: gradings.map(mapGrading)
    };
  }
}

export class SqliteErrorDiagnosisRepository implements ErrorDiagnosisRepository {
  constructor(private readonly database: SqlDatabase, private readonly transactionScope: SqlTransactionScope) {}
  async append(values: readonly ErrorDiagnosisRecord[], context: TransactionContext): Promise<void> {
    const transaction = this.transactionScope.resolve(context);
    await runBatch(transaction, values.map(diagnosisStatement));
  }
  async listBySession(sessionId: LearningSessionId): Promise<readonly ErrorDiagnosisRecord[]> {
    const rows = await this.database.query<DiagnosisRow>(
      `SELECT diagnosis.*, attempt.session_id FROM error_diagnoses diagnosis
       JOIN attempts attempt ON attempt.id = diagnosis.attempt_id
       WHERE attempt.session_id = ? ORDER BY diagnosis.created_at, diagnosis.id`, [sessionId]
    );
    return rows.map(mapDiagnosis);
  }

  async listBySessions(sessionIds: readonly LearningSessionId[]): Promise<readonly ErrorDiagnosisRecord[]> {
    if (!sessionIds.length) return [];
    const rows = await this.database.query<DiagnosisRow>(
      `SELECT diagnosis.*, attempt.session_id FROM error_diagnoses diagnosis
       JOIN attempts attempt ON attempt.id = diagnosis.attempt_id
       WHERE attempt.session_id IN (${sessionIds.map(() => '?').join(',')})
       ORDER BY diagnosis.created_at, diagnosis.id`,
      sessionIds
    );
    return rows.map(mapDiagnosis);
  }
  async find(diagnosisId: ErrorDiagnosisId): Promise<ErrorDiagnosisRecord | undefined> {
    const rows = await this.database.query<DiagnosisRow>(
      `SELECT diagnosis.*, attempt.session_id FROM error_diagnoses diagnosis
       JOIN attempts attempt ON attempt.id = diagnosis.attempt_id
       WHERE diagnosis.id = ? LIMIT 1`, [diagnosisId]
    );
    return rows[0] ? mapDiagnosis(rows[0]) : undefined;
  }
  async findMany(diagnosisIds: readonly ErrorDiagnosisId[]): Promise<readonly ErrorDiagnosisRecord[]> {
    if (!diagnosisIds.length) return [];
    const rows = await this.database.query<DiagnosisRow>(
      `SELECT diagnosis.*, attempt.session_id FROM error_diagnoses diagnosis
       JOIN attempts attempt ON attempt.id = diagnosis.attempt_id
       WHERE diagnosis.id IN (${diagnosisIds.map(() => '?').join(',')})`,
      diagnosisIds
    );
    return rows.map(mapDiagnosis);
  }
  async findByIdempotencyKey(idempotencyKey: string): Promise<ErrorDiagnosisRecord | undefined> {
    const rows = await this.database.query<DiagnosisRow>(
      `SELECT diagnosis.*, attempt.session_id FROM error_diagnoses diagnosis
       JOIN attempts attempt ON attempt.id = diagnosis.attempt_id
       WHERE diagnosis.idempotency_key = ? LIMIT 1`, [idempotencyKey]
    );
    return rows[0] ? mapDiagnosis(rows[0]) : undefined;
  }
  async findByIdempotencyKeys(idempotencyKeys: readonly string[]): Promise<readonly ErrorDiagnosisRecord[]> {
    if (!idempotencyKeys.length) return [];
    const rows = await this.database.query<DiagnosisRow>(
      `SELECT diagnosis.*, attempt.session_id FROM error_diagnoses diagnosis
       JOIN attempts attempt ON attempt.id = diagnosis.attempt_id
       WHERE diagnosis.idempotency_key IN (${idempotencyKeys.map(() => '?').join(',')})`,
      idempotencyKeys
    );
    return rows.map(mapDiagnosis);
  }
  async appendConfirmation(
    confirmation: ErrorDiagnosisConfirmationRecord,
    nextProjection: ErrorDiagnosisCurrentProjection,
    expectedProjectionVersion: number | undefined,
    context: TransactionContext
  ): Promise<void> {
    const transaction = this.transactionScope.resolve(context);
    await transaction.run(
      `INSERT INTO error_diagnosis_confirmations(
        id, error_diagnosis_id, attempt_id, exam_cycle_id, action, corrected_cause_code,
        corrected_detail, actor_type, created_at, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [confirmation.id, confirmation.diagnosisId, confirmation.attemptId, confirmation.examCycleId,
        confirmation.action, confirmation.correctedCauseCode ?? null, confirmation.correctedDetail ?? null,
        confirmation.actorType, confirmation.createdAt, confirmation.idempotencyKey]
    );
    if (expectedProjectionVersion === undefined) {
      await transaction.run(
        `INSERT INTO error_diagnosis_current_projection(
          error_diagnosis_id, latest_confirmation_id, confirmation_status, effective_cause_code,
          effective_detail, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nextProjection.diagnosisId, nextProjection.latestConfirmationId, nextProjection.confirmationStatus,
          nextProjection.effectiveCauseCode, nextProjection.effectiveDetail, nextProjection.updatedAt,
          nextProjection.version]
      );
      return;
    }
    if (nextProjection.version !== expectedProjectionVersion + 1) {
      throw new Error('Error diagnosis projection version must advance by one');
    }
    const result = await transaction.run(
      `UPDATE error_diagnosis_current_projection SET latest_confirmation_id = ?, confirmation_status = ?,
        effective_cause_code = ?, effective_detail = ?, updated_at = ?, version = ?
       WHERE error_diagnosis_id = ? AND version = ?`,
      [nextProjection.latestConfirmationId, nextProjection.confirmationStatus, nextProjection.effectiveCauseCode,
        nextProjection.effectiveDetail, nextProjection.updatedAt, nextProjection.version,
        nextProjection.diagnosisId, expectedProjectionVersion]
    );
    if (result.changes !== 1) throw new Error(`Error diagnosis projection version conflict: ${nextProjection.diagnosisId}`);
  }
  async findConfirmationByIdempotencyKey(idempotencyKey: string): Promise<ErrorDiagnosisConfirmationRecord | undefined> {
    const rows = await this.database.query<DiagnosisConfirmationRow>(
      'SELECT * FROM error_diagnosis_confirmations WHERE idempotency_key = ? LIMIT 1', [idempotencyKey]
    );
    return rows[0] ? mapDiagnosisConfirmation(rows[0]) : undefined;
  }
  async findCurrentProjection(diagnosisId: ErrorDiagnosisId): Promise<ErrorDiagnosisCurrentProjection | undefined> {
    const rows = await this.database.query<DiagnosisProjectionRow>(
      'SELECT * FROM error_diagnosis_current_projection WHERE error_diagnosis_id = ? LIMIT 1', [diagnosisId]
    );
    return rows[0] ? mapDiagnosisProjection(rows[0]) : undefined;
  }

  async listCurrentProjections(
    diagnosisIds: readonly ErrorDiagnosisId[]
  ): Promise<readonly ErrorDiagnosisCurrentProjection[]> {
    if (!diagnosisIds.length) return [];
    const rows = await this.database.query<DiagnosisProjectionRow>(
      `SELECT * FROM error_diagnosis_current_projection
       WHERE error_diagnosis_id IN (${diagnosisIds.map(() => '?').join(',')})`,
      diagnosisIds
    );
    return rows.map(mapDiagnosisProjection);
  }
}

export class SqliteLearningEvidenceRepository implements LearningEvidenceRepository {
  constructor(private readonly database: SqlDatabase, private readonly transactionScope: SqlTransactionScope) {}
  async append(
    evidence: readonly LearningEvidenceRecord[],
    validity: readonly EvidenceValidityProjection[],
    context: TransactionContext
  ): Promise<void> {
    const transaction = this.transactionScope.resolve(context);
    await runBatch(transaction, [
      ...evidence.map(evidenceStatement),
      ...validity.map(validityStatement)
    ]);
  }
  async appendCorrection(
    correction: EvidenceCorrectionRecord,
    nextValidity: EvidenceValidityProjection,
    expectedProjectionVersion: number,
    context: TransactionContext
  ): Promise<void> {
    if (nextValidity.version !== expectedProjectionVersion + 1) throw new Error('Evidence validity version must advance by one');
    const transaction = this.transactionScope.resolve(context);
    await transaction.run(
      `INSERT INTO evidence_corrections(
        id, exam_cycle_id, evidence_id, action, reason_code, reason_detail,
        replacement_evidence_id, actor_type, created_at, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [correction.id, correction.examCycleId, correction.evidenceId, correction.action,
        correction.reasonCode, correction.reasonDetail ?? null, correction.replacementEvidenceId ?? null,
        correction.actorType, correction.createdAt, correction.idempotencyKey]
    );
    const result = await transaction.run(
      `UPDATE evidence_validity_projection SET validity_status = ?, latest_correction_id = ?,
        updated_at = ?, version = ? WHERE evidence_id = ? AND version = ?`,
      [nextValidity.validityStatus, nextValidity.latestCorrectionId ?? null, nextValidity.updatedAt,
        nextValidity.version, nextValidity.evidenceId, expectedProjectionVersion]
    );
    if (result.changes !== 1) throw new Error(`Evidence validity version conflict: ${nextValidity.evidenceId}`);
  }
  async find(evidenceId: EvidenceId): Promise<LearningEvidenceRecord | undefined> {
    const rows = await this.database.query<EvidenceRow>('SELECT * FROM learning_evidence WHERE id = ? LIMIT 1', [evidenceId]);
    return rows[0] ? mapEvidence(rows[0]) : undefined;
  }
  async findValidity(evidenceId: EvidenceId): Promise<EvidenceValidityProjection | undefined> {
    const rows = await this.database.query<ValidityRow>(
      'SELECT * FROM evidence_validity_projection WHERE evidence_id = ? LIMIT 1', [evidenceId]
    );
    return rows[0] ? mapValidity(rows[0]) : undefined;
  }
  async findByIdempotencyKey(idempotencyKey: string): Promise<LearningEvidenceRecord | undefined> {
    const rows = await this.database.query<EvidenceRow>(
      'SELECT * FROM learning_evidence WHERE idempotency_key = ? LIMIT 1', [idempotencyKey]
    );
    return rows[0] ? mapEvidence(rows[0]) : undefined;
  }
  async findCorrectionByIdempotencyKey(idempotencyKey: string): Promise<EvidenceCorrectionRecord | undefined> {
    const rows = await this.database.query<CorrectionRow>(
      'SELECT * FROM evidence_corrections WHERE idempotency_key = ? LIMIT 1', [idempotencyKey]
    );
    return rows[0] ? mapCorrection(rows[0]) : undefined;
  }
  async listValid(
    examCycleId: ExamCycleId,
    capabilityNodeId: CapabilityNodeId,
    limit: number
  ): Promise<readonly LearningEvidenceRecord[]> {
    assertLimit(limit);
    const rows = await this.database.query<EvidenceRow>(
      `SELECT evidence.* FROM learning_evidence evidence
       JOIN evidence_validity_projection validity ON validity.evidence_id = evidence.id
       WHERE evidence.exam_cycle_id = ? AND evidence.capability_node_id = ? AND validity.validity_status = 'valid'
       ORDER BY evidence.occurred_at DESC, evidence.id DESC LIMIT ?`,
      [examCycleId, capabilityNodeId, limit]
    );
    return rows.map(mapEvidence);
  }

  async listAllValid(examCycleId: ExamCycleId): Promise<readonly LearningEvidenceRecord[]> {
    const rows = await this.database.query<EvidenceRow>(
      `SELECT evidence.* FROM learning_evidence evidence
       JOIN evidence_validity_projection validity ON validity.evidence_id = evidence.id
       WHERE evidence.exam_cycle_id = ? AND validity.validity_status = 'valid'
       ORDER BY evidence.occurred_at DESC, evidence.id DESC`,
      [examCycleId]
    );
    return rows.map(mapEvidence);
  }
}

async function runBatch(tx: SqlTransaction, statements: readonly SqlBatchStatement[]): Promise<void> {
  if (!statements.length) return;
  if (tx.runBatch) {
    await tx.runBatch(statements);
    return;
  }
  for (const statement of statements) await tx.run(statement.sql, statement.parameters);
}

function sessionStatement(value: LearningSessionRecord): SqlBatchStatement {
  return {
    sql: `INSERT INTO learning_sessions(
      id, exam_cycle_id, learning_thread_id, question_set_id, review_queue_item_id, session_type, assessment_role,
      status, started_at, completed_at, elapsed_ms, question_count, answered_count, correct_count,
      idempotency_key, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    parameters: [value.id, value.examCycleId, value.learningThreadId, value.questionSetId, value.reviewQueueItemId ?? null, value.sessionType,
      value.assessmentRole, value.status, value.startedAt, value.completedAt, value.elapsedMs,
      value.questionCount, value.answeredCount, value.correctCount, value.idempotencyKey,
      value.version, value.createdAt, value.updatedAt]
  };
}
function exposureStatement(value: QuestionExposureRecord): SqlBatchStatement {
  return {
    sql: `INSERT INTO question_exposures(
      id, exam_cycle_id, learning_thread_id, session_id, question_id, exposure_type,
      answer_exposed, occurred_at, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    parameters: [value.id, value.examCycleId, value.learningThreadId, value.sessionId, value.questionId,
      value.exposureType, value.answerExposed ? 1 : 0, value.occurredAt, value.idempotencyKey]
  };
}
function attemptStatement(value: AttemptRecord): SqlBatchStatement {
  return {
    sql: `INSERT INTO attempts(
      id, session_id, question_id, exam_cycle_id, capability_node_id, learning_thread_id,
      assessment_role, question_content_version, answer_json, result, score, elapsed_ms,
      confidence, hint_level, answer_change_count, submitted_at, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    parameters: [value.id, value.sessionId, value.questionId, value.examCycleId, value.capabilityNodeId,
      value.learningThreadId, value.assessmentRole, value.questionContentVersion, JSON.stringify(value.answer),
      value.result, value.score, value.elapsedMs ?? null, value.confidence ?? null, value.hintLevel,
      value.answerChangeCount, value.submittedAt, value.idempotencyKey]
  };
}
function observationStatement(value: DecisionObservationRecord): SqlBatchStatement {
  return {
    sql: `INSERT INTO decision_observations(
      id, attempt_id, observation_type, value_code, value_json, source, confidence, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    parameters: [value.id, value.attemptId, value.observationType, value.valueCode,
      JSON.stringify(value.value), value.source, value.confidence, value.occurredAt]
  };
}
function gradingStatement(value: GradingResultRecord): SqlBatchStatement {
  return {
    sql: `INSERT INTO grading_results(
      id, attempt_id, grading_method, grader_version, result, score, normalized_feedback_json,
      raw_response_json, confidence, confirmation_status, created_at, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    parameters: [value.id, value.attemptId, value.gradingMethod, value.graderVersion, value.result, value.score,
      JSON.stringify(value.normalizedFeedback), value.rawResponse ? JSON.stringify(value.rawResponse) : null,
      value.confidence, value.confirmationStatus, value.createdAt, value.idempotencyKey]
  };
}
function diagnosisStatement(value: ErrorDiagnosisRecord): SqlBatchStatement {
  return {
    sql: `INSERT INTO error_diagnoses(
      id, grading_result_id, attempt_id, exam_cycle_id, capability_node_id, cause_code,
      error_stage, detail, confidence, confirmation_status, prerequisite_capability_node_id,
      recommended_action_code, dimensions_json, correction_plan_json, source, created_at, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    parameters: [value.id, value.gradingResultId, value.attemptId, value.examCycleId, value.capabilityNodeId,
      value.causeCode, value.errorStage ?? null, value.detail, value.confidence, value.confirmationStatus,
      value.prerequisiteCapabilityNodeId ?? null, value.recommendedActionCode,
      JSON.stringify(value.dimensions), JSON.stringify(value.correctionPlan), value.source,
      value.createdAt, value.idempotencyKey]
  };
}
function evidenceStatement(value: LearningEvidenceRecord): SqlBatchStatement {
  return {
    sql: `INSERT INTO learning_evidence(
      id, exam_cycle_id, capability_node_id, attempt_id, assessment_role, evidence_type,
      value, weight, quality, source, validation_policy_version, occurred_at, idempotency_key, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    parameters: [value.id, value.examCycleId, value.capabilityNodeId, value.attemptId ?? null,
      value.assessmentRole, value.evidenceType, value.value ?? null, value.weight, value.quality,
      value.source, value.validationPolicyVersion, value.occurredAt, value.idempotencyKey,
      JSON.stringify(value.metadata)]
  };
}
function validityStatement(value: EvidenceValidityProjection): SqlBatchStatement {
  return {
    sql: `INSERT INTO evidence_validity_projection(
      evidence_id, validity_status, latest_correction_id, updated_at, version
    ) VALUES (?, ?, ?, ?, ?)`,
    parameters: [value.evidenceId, value.validityStatus, value.latestCorrectionId ?? null, value.updatedAt, value.version]
  };
}

function mapSession(row: SessionRow): LearningSessionRecord {
  return {
    id: row.id as LearningSessionId, examCycleId: row.exam_cycle_id as ExamCycleId,
    learningThreadId: row.learning_thread_id as LearningThreadId, questionSetId: row.question_set_id as QuestionSetId,
    reviewQueueItemId: row.review_queue_item_id as ReviewQueueItemId | null ?? undefined,
    sessionType: row.session_type, assessmentRole: row.assessment_role, status: row.status,
    startedAt: row.started_at as InstantMs, completedAt: row.completed_at as InstantMs,
    elapsedMs: row.elapsed_ms, questionCount: row.question_count, answeredCount: row.answered_count,
    correctCount: row.correct_count, idempotencyKey: row.idempotency_key, version: row.version,
    createdAt: row.created_at as InstantMs, updatedAt: row.updated_at as InstantMs
  };
}
function mapExposure(row: ExposureRow): QuestionExposureRecord {
  return {
    id: row.id as QuestionExposureId, examCycleId: row.exam_cycle_id as ExamCycleId,
    learningThreadId: row.learning_thread_id as LearningThreadId, sessionId: row.session_id as LearningSessionId,
    questionId: row.question_id as QuestionId, exposureType: row.exposure_type,
    answerExposed: row.answer_exposed === 1, occurredAt: row.occurred_at as InstantMs,
    idempotencyKey: row.idempotency_key
  };
}
function mapAttempt(row: AttemptRow): AttemptRecord {
  return {
    id: row.id as AttemptId, sessionId: row.session_id as LearningSessionId, questionId: row.question_id as QuestionId,
    examCycleId: row.exam_cycle_id as ExamCycleId, capabilityNodeId: row.capability_node_id as CapabilityNodeId,
    learningThreadId: row.learning_thread_id as LearningThreadId, assessmentRole: row.assessment_role,
    questionContentVersion: row.question_content_version, answer: parseObject(row.answer_json, 'attempts.answer_json'),
    result: row.result, score: row.score, elapsedMs: row.elapsed_ms ?? undefined,
    confidence: row.confidence ?? undefined, hintLevel: row.hint_level,
    answerChangeCount: row.answer_change_count, submittedAt: row.submitted_at as InstantMs,
    idempotencyKey: row.idempotency_key
  };
}
function mapObservation(row: ObservationRow): DecisionObservationRecord {
  if (!isDecisionObservationType(row.observation_type)) {
    throw new Error(`Invalid decision observation type in database: ${row.observation_type}`);
  }
  return {
    id: row.id as DecisionObservationId, attemptId: row.attempt_id as AttemptId,
    observationType: row.observation_type, valueCode: row.value_code,
    value: parseObject(row.value_json, 'decision_observations.value_json'), source: row.source,
    confidence: row.confidence, occurredAt: row.occurred_at as InstantMs
  };
}
function mapGrading(row: GradingRow): GradingResultRecord {
  return {
    id: row.id as GradingResultId, attemptId: row.attempt_id as AttemptId,
    gradingMethod: row.grading_method, graderVersion: row.grader_version, result: row.result,
    score: row.score, normalizedFeedback: parseObject(row.normalized_feedback_json, 'grading_results.normalized_feedback_json'),
    rawResponse: row.raw_response_json ? parseObject(row.raw_response_json, 'grading_results.raw_response_json') : undefined,
    confidence: row.confidence, confirmationStatus: row.confirmation_status,
    createdAt: row.created_at as InstantMs, idempotencyKey: row.idempotency_key
  };
}
function mapDiagnosis(row: DiagnosisRow): ErrorDiagnosisRecord {
  return {
    id: row.id as ErrorDiagnosisId, sessionId: row.session_id as LearningSessionId,
    gradingResultId: row.grading_result_id as GradingResultId,
    attemptId: row.attempt_id as AttemptId, examCycleId: row.exam_cycle_id as ExamCycleId,
    capabilityNodeId: row.capability_node_id as CapabilityNodeId, causeCode: row.cause_code,
    errorStage: row.error_stage ?? undefined, detail: row.detail, confidence: row.confidence,
    confirmationStatus: row.confirmation_status,
    prerequisiteCapabilityNodeId: row.prerequisite_capability_node_id as CapabilityNodeId | null ?? undefined,
    recommendedActionCode: row.recommended_action_code,
    dimensions: parseDiagnosisDimensions(row.dimensions_json),
    correctionPlan: parseCorrectionPlan(row.correction_plan_json),
    source: row.source,
    createdAt: row.created_at as InstantMs, idempotencyKey: row.idempotency_key
  };
}
function mapDiagnosisConfirmation(row: DiagnosisConfirmationRow): ErrorDiagnosisConfirmationRecord {
  return {
    id: row.id as ErrorDiagnosisConfirmationId,
    diagnosisId: row.error_diagnosis_id as ErrorDiagnosisId,
    attemptId: row.attempt_id as AttemptId,
    examCycleId: row.exam_cycle_id as ExamCycleId,
    action: row.action,
    correctedCauseCode: row.corrected_cause_code ?? undefined,
    correctedDetail: row.corrected_detail ?? undefined,
    actorType: row.actor_type,
    createdAt: row.created_at as InstantMs,
    idempotencyKey: row.idempotency_key
  };
}
function mapDiagnosisProjection(row: DiagnosisProjectionRow): ErrorDiagnosisCurrentProjection {
  return {
    diagnosisId: row.error_diagnosis_id as ErrorDiagnosisId,
    latestConfirmationId: row.latest_confirmation_id as ErrorDiagnosisConfirmationId,
    confirmationStatus: row.confirmation_status,
    effectiveCauseCode: row.effective_cause_code,
    effectiveDetail: row.effective_detail,
    updatedAt: row.updated_at as InstantMs,
    version: row.version
  };
}
function mapEvidence(row: EvidenceRow): LearningEvidenceRecord {
  return {
    id: row.id as EvidenceId, examCycleId: row.exam_cycle_id as ExamCycleId,
    capabilityNodeId: row.capability_node_id as CapabilityNodeId,
    attemptId: row.attempt_id as AttemptId | null ?? undefined, assessmentRole: row.assessment_role,
    evidenceType: row.evidence_type, value: row.value ?? undefined, weight: row.weight,
    quality: row.quality, source: row.source, validationPolicyVersion: row.validation_policy_version,
    occurredAt: row.occurred_at as InstantMs, idempotencyKey: row.idempotency_key,
    metadata: parseObject(row.metadata_json, 'learning_evidence.metadata_json')
  };
}
function mapValidity(row: ValidityRow): EvidenceValidityProjection {
  return {
    evidenceId: row.evidence_id as EvidenceId, validityStatus: row.validity_status,
    latestCorrectionId: row.latest_correction_id as EvidenceCorrectionId | null ?? undefined,
    updatedAt: row.updated_at as InstantMs, version: row.version
  };
}
function mapCorrection(row: CorrectionRow): EvidenceCorrectionRecord {
  return {
    id: row.id as EvidenceCorrectionId,
    examCycleId: row.exam_cycle_id as ExamCycleId,
    evidenceId: row.evidence_id as EvidenceId,
    action: row.action,
    reasonCode: row.reason_code,
    reasonDetail: row.reason_detail ?? undefined,
    replacementEvidenceId: row.replacement_evidence_id as EvidenceId | null ?? undefined,
    actorType: row.actor_type,
    createdAt: row.created_at as InstantMs,
    idempotencyKey: row.idempotency_key
  };
}
function parseObject(value: string, field: string): JsonObject {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError(`${field} must be an object`);
  return parsed as JsonObject;
}
function parseDiagnosisDimensions(value: string): readonly ErrorDiagnosisDimension[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item): ErrorDiagnosisDimension[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (
      !Object.values(ErrorDiagnosisDimensionCode).includes(row.code as never)
      || !Object.values(ErrorDiagnosisDimensionStatus).includes(row.status as never)
      || typeof row.evidence !== 'string'
      || !row.evidence.trim()
    ) return [];
    return [{
      code: row.code as ErrorDiagnosisDimension['code'],
      status: row.status as ErrorDiagnosisDimension['status'],
      evidence: row.evidence.trim()
    }];
  }).slice(0, 4);
}
function parseCorrectionPlan(value: string): ErrorCorrectionPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || '{}');
  } catch {
    parsed = {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyCorrectionPlan();
  const row = parsed as Record<string, unknown>;
  const steps = Array.isArray(row.steps)
    ? row.steps.filter((step): step is string => typeof step === 'string' && Boolean(step.trim())).map((step) => step.trim()).slice(0, 4)
    : [];
  if (
    typeof row.objective !== 'string'
    || !row.objective.trim()
    || !steps.length
    || typeof row.practiceFocus !== 'string'
    || !row.practiceFocus.trim()
    || typeof row.successCriteria !== 'string'
    || !row.successCriteria.trim()
  ) return emptyCorrectionPlan();
  return {
    objective: row.objective.trim(),
    steps,
    practiceFocus: row.practiceFocus.trim(),
    successCriteria: row.successCriteria.trim()
  };
}
function emptyCorrectionPlan(): ErrorCorrectionPlan {
  return {
    objective: '',
    steps: [],
    practiceFocus: '',
    successCriteria: ''
  };
}
function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError('Evidence query limit must be between 1 and 500');
}
