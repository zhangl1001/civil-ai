import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb, TutorIndexedDbStore } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { CapabilityNodeId, ErrorDiagnosisId, EvidenceId, ExamCycleId, LearningSessionId, QuestionSetId } from '@/kernel/public';
import type {
  ErrorDiagnosisRepository,
  LearningEvidenceRepository,
  LearningSessionRepository
} from '../contracts/LearningRepositories';
import type {
  ErrorDiagnosisRecord,
  ErrorDiagnosisConfirmationRecord,
  ErrorDiagnosisCurrentProjection,
  EvidenceCorrectionRecord,
  EvidenceValidityProjection,
  LearningEvidenceRecord,
  ObjectiveSessionFacts
} from '../contracts/LearningFacts';

interface StoredSessionFacts extends ObjectiveSessionFacts {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly examCycleKey: string;
  readonly threadKey: string;
}

interface StoredDiagnosis extends ErrorDiagnosisRecord {
  readonly sessionKey: string;
  readonly idempotencyKey: string;
}

interface StoredDiagnosisConfirmation extends ErrorDiagnosisConfirmationRecord {
  readonly diagnosisKey: string;
  readonly idempotencyKey: string;
}

interface StoredEvidenceAggregate {
  readonly evidenceId: string;
  readonly idempotencyKey: string;
  readonly examCycleKey: string;
  readonly capabilityKey: string;
  readonly evidence: LearningEvidenceRecord;
  readonly validity: EvidenceValidityProjection;
  readonly corrections: readonly EvidenceCorrectionRecord[];
}

export class IndexedDbLearningSessionRepository implements LearningSessionRepository {
  constructor(private readonly database: TutorIndexedDb, private readonly transactionScope: IndexedDbTransactionScope) {}

  async commitObjectiveSession(facts: ObjectiveSessionFacts, context: TransactionContext): Promise<void> {
    const existing = await this.findByIdempotencyKey(facts.session.idempotencyKey);
    if (existing) throw new Error(`Learning session already exists for ${facts.session.idempotencyKey}`);
    this.transactionScope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.LearningSessionFacts,
      value: storedSession(facts)
    });
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<ObjectiveSessionFacts | undefined> {
    const values = await this.database.getAll<StoredSessionFacts>(TutorIndexedDbStore.LearningSessionFacts);
    const value = values.find((item) => item.idempotencyKey === idempotencyKey);
    return value ? factsOf(value) : undefined;
  }

  async findById(sessionId: LearningSessionId): Promise<ObjectiveSessionFacts | undefined> {
    const value = await this.database.get<StoredSessionFacts>(TutorIndexedDbStore.LearningSessionFacts, sessionId);
    return value ? factsOf(value) : undefined;
  }

  async listByQuestionSet(questionSetId: QuestionSetId, limit: number): Promise<readonly ObjectiveSessionFacts[]> {
    assertSessionLimit(limit);
    const values = await this.database.getAllByIndex<StoredSessionFacts>(
      TutorIndexedDbStore.LearningSessionFacts,
      'by_question_set',
      questionSetId
    );
    return values
      .slice()
      .sort((left, right) => right.session.completedAt - left.session.completedAt || right.session.id.localeCompare(left.session.id))
      .slice(0, limit)
      .map(factsOf);
  }

  async listRecent(examCycleId: ExamCycleId, limit: number, offset = 0): Promise<readonly ObjectiveSessionFacts[]> {
    assertSessionLimit(limit);
    if (!Number.isInteger(offset) || offset < 0) throw new RangeError('Evidence query offset must be a non-negative integer');
    return (await this.listAll(examCycleId)).slice(offset, offset + limit);
  }

  async listAll(examCycleId: ExamCycleId): Promise<readonly ObjectiveSessionFacts[]> {
    const values = await this.database.getAll<StoredSessionFacts>(TutorIndexedDbStore.LearningSessionFacts);
    return values
      .filter((item) => item.examCycleKey === examCycleId)
      .sort((left, right) => right.session.startedAt - left.session.startedAt || right.session.id.localeCompare(left.session.id))
      .map(factsOf);
  }
}

export class IndexedDbErrorDiagnosisRepository implements ErrorDiagnosisRepository {
  constructor(private readonly database: TutorIndexedDb, private readonly transactionScope: IndexedDbTransactionScope) {}

  async append(diagnoses: readonly ErrorDiagnosisRecord[], context: TransactionContext): Promise<void> {
    for (const diagnosis of diagnoses) {
      const existing = await this.findByIdempotencyKey(diagnosis.idempotencyKey);
      if (existing) throw new Error(`Error diagnosis already exists for ${diagnosis.idempotencyKey}`);
      this.transactionScope.stage(context, {
        type: 'add',
        store: TutorIndexedDbStore.ErrorDiagnoses,
        value: { ...diagnosis, sessionKey: diagnosis.sessionId } satisfies StoredDiagnosis
      });
    }
  }

  async listBySession(sessionId: LearningSessionId): Promise<readonly ErrorDiagnosisRecord[]> {
    const values = await this.database.getAll<StoredDiagnosis>(TutorIndexedDbStore.ErrorDiagnoses);
    return values
      .filter((item) => item.sessionKey === sessionId)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(normalizeStoredDiagnosis);
  }

  async listBySessions(sessionIds: readonly LearningSessionId[]): Promise<readonly ErrorDiagnosisRecord[]> {
    const wanted = new Set<string>(sessionIds);
    const values = await this.database.getAll<StoredDiagnosis>(TutorIndexedDbStore.ErrorDiagnoses);
    return values
      .filter((item) => wanted.has(item.sessionKey))
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(normalizeStoredDiagnosis);
  }
  async find(diagnosisId: ErrorDiagnosisId): Promise<ErrorDiagnosisRecord | undefined> {
    const value = await this.database.get<StoredDiagnosis>(TutorIndexedDbStore.ErrorDiagnoses, diagnosisId);
    if (!value) return undefined;
    return normalizeStoredDiagnosis(value);
  }

  async findMany(diagnosisIds: readonly ErrorDiagnosisId[]): Promise<readonly ErrorDiagnosisRecord[]> {
    const wanted = new Set<string>(diagnosisIds);
    const values = await this.database.getAll<StoredDiagnosis>(TutorIndexedDbStore.ErrorDiagnoses);
    return values
      .filter((item) => wanted.has(item.id))
      .map(normalizeStoredDiagnosis);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<ErrorDiagnosisRecord | undefined> {
    const values = await this.database.getAll<StoredDiagnosis>(TutorIndexedDbStore.ErrorDiagnoses);
    const value = values.find((item) => item.idempotencyKey === idempotencyKey);
    if (!value) return undefined;
    return normalizeStoredDiagnosis(value);
  }
  async findByIdempotencyKeys(idempotencyKeys: readonly string[]): Promise<readonly ErrorDiagnosisRecord[]> {
    const wanted = new Set(idempotencyKeys);
    const values = await this.database.getAll<StoredDiagnosis>(TutorIndexedDbStore.ErrorDiagnoses);
    return values
      .filter((item) => wanted.has(item.idempotencyKey))
      .map(normalizeStoredDiagnosis);
  }
  async appendConfirmation(
    confirmation: ErrorDiagnosisConfirmationRecord,
    nextProjection: ErrorDiagnosisCurrentProjection,
    expectedProjectionVersion: number | undefined,
    context: TransactionContext
  ): Promise<void> {
    const existing = await this.findConfirmationByIdempotencyKey(confirmation.idempotencyKey);
    if (existing) throw new Error(`Error diagnosis confirmation already exists for ${confirmation.idempotencyKey}`);
    const current = await this.findCurrentProjection(confirmation.diagnosisId);
    if (current?.version !== expectedProjectionVersion || nextProjection.version !== (expectedProjectionVersion ?? 0) + 1) {
      throw new Error(`Error diagnosis projection version conflict: ${confirmation.diagnosisId}`);
    }
    this.transactionScope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.ErrorDiagnosisConfirmations,
      value: { ...confirmation, diagnosisKey: confirmation.diagnosisId } satisfies StoredDiagnosisConfirmation
    });
    this.transactionScope.stage(context, {
      type: current ? 'put' : 'add',
      store: TutorIndexedDbStore.ErrorDiagnosisProjections,
      value: nextProjection
    });
  }
  async findConfirmationByIdempotencyKey(idempotencyKey: string): Promise<ErrorDiagnosisConfirmationRecord | undefined> {
    const values = await this.database.getAll<StoredDiagnosisConfirmation>(TutorIndexedDbStore.ErrorDiagnosisConfirmations);
    const value = values.find((item) => item.idempotencyKey === idempotencyKey);
    if (!value) return undefined;
    const { diagnosisKey: _diagnosisKey, ...confirmation } = value;
    return confirmation;
  }
  async findCurrentProjection(diagnosisId: ErrorDiagnosisId): Promise<ErrorDiagnosisCurrentProjection | undefined> {
    return this.database.get<ErrorDiagnosisCurrentProjection>(TutorIndexedDbStore.ErrorDiagnosisProjections, diagnosisId);
  }

  async listCurrentProjections(diagnosisIds: readonly ErrorDiagnosisId[]): Promise<readonly ErrorDiagnosisCurrentProjection[]> {
    const wanted = new Set<string>(diagnosisIds);
    return (await this.database.getAll<ErrorDiagnosisCurrentProjection>(TutorIndexedDbStore.ErrorDiagnosisProjections))
      .filter((item) => wanted.has(item.diagnosisId));
  }
}

function normalizeStoredDiagnosis(value: StoredDiagnosis): ErrorDiagnosisRecord {
  const { sessionKey: _sessionKey, ...diagnosis } = value;
  const correctionPlan = diagnosis.correctionPlan;
  return {
    ...diagnosis,
    dimensions: Array.isArray(diagnosis.dimensions) ? diagnosis.dimensions : [],
    correctionPlan: correctionPlan && typeof correctionPlan === 'object'
      ? {
          objective: typeof correctionPlan.objective === 'string' ? correctionPlan.objective : '',
          steps: Array.isArray(correctionPlan.steps)
            ? correctionPlan.steps.filter((step): step is string => typeof step === 'string')
            : [],
          practiceFocus: typeof correctionPlan.practiceFocus === 'string' ? correctionPlan.practiceFocus : '',
          successCriteria: typeof correctionPlan.successCriteria === 'string' ? correctionPlan.successCriteria : ''
        }
      : {
          objective: '',
          steps: [],
          practiceFocus: '',
          successCriteria: ''
        }
  };
}

export class IndexedDbLearningEvidenceRepository implements LearningEvidenceRepository {
  constructor(private readonly database: TutorIndexedDb, private readonly transactionScope: IndexedDbTransactionScope) {}

  async append(
    evidence: readonly LearningEvidenceRecord[],
    validity: readonly EvidenceValidityProjection[],
    context: TransactionContext
  ): Promise<void> {
    const validityByEvidence = new Map(validity.map((item) => [item.evidenceId, item]));
    for (const item of evidence) {
      const projection = validityByEvidence.get(item.id);
      if (!projection) throw new Error(`Learning evidence is missing validity projection: ${item.id}`);
      const existing = await this.findByIdempotencyKey(item.idempotencyKey);
      if (existing) throw new Error(`Learning evidence already exists for ${item.idempotencyKey}`);
      this.transactionScope.stage(context, {
        type: 'add',
        store: TutorIndexedDbStore.LearningEvidenceAggregates,
        value: storedEvidence(item, projection, [])
      });
    }
  }

  async appendCorrection(
    correction: EvidenceCorrectionRecord,
    nextValidity: EvidenceValidityProjection,
    expectedProjectionVersion: number,
    context: TransactionContext
  ): Promise<void> {
    const current = await this.database.get<StoredEvidenceAggregate>(
      TutorIndexedDbStore.LearningEvidenceAggregates,
      correction.evidenceId
    );
    if (!current || current.validity.version !== expectedProjectionVersion || nextValidity.version !== expectedProjectionVersion + 1) {
      throw new Error(`Evidence validity version conflict: ${correction.evidenceId}`);
    }
    if (current.corrections.some((item) => item.idempotencyKey === correction.idempotencyKey)) {
      throw new Error(`Evidence correction already exists for ${correction.idempotencyKey}`);
    }
    this.transactionScope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.LearningEvidenceAggregates,
      value: storedEvidence(current.evidence, nextValidity, [...current.corrections, correction])
    });
  }

  async find(evidenceId: EvidenceId): Promise<LearningEvidenceRecord | undefined> {
    const value = await this.database.get<StoredEvidenceAggregate>(TutorIndexedDbStore.LearningEvidenceAggregates, evidenceId);
    return value?.evidence;
  }

  async findValidity(evidenceId: EvidenceId): Promise<EvidenceValidityProjection | undefined> {
    const value = await this.database.get<StoredEvidenceAggregate>(TutorIndexedDbStore.LearningEvidenceAggregates, evidenceId);
    return value?.validity;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<LearningEvidenceRecord | undefined> {
    const values = await this.database.getAll<StoredEvidenceAggregate>(TutorIndexedDbStore.LearningEvidenceAggregates);
    return values.find((item) => item.idempotencyKey === idempotencyKey)?.evidence;
  }

  async findCorrectionByIdempotencyKey(idempotencyKey: string): Promise<EvidenceCorrectionRecord | undefined> {
    const values = await this.database.getAll<StoredEvidenceAggregate>(TutorIndexedDbStore.LearningEvidenceAggregates);
    return values.flatMap((item) => item.corrections).find((item) => item.idempotencyKey === idempotencyKey);
  }

  async listValid(
    examCycleId: ExamCycleId,
    capabilityNodeId: CapabilityNodeId,
    limit: number
  ): Promise<readonly LearningEvidenceRecord[]> {
    assertLimit(limit);
    const values = await this.database.getAll<StoredEvidenceAggregate>(TutorIndexedDbStore.LearningEvidenceAggregates);
    return values
      .filter((item) => item.examCycleKey === examCycleId && item.capabilityKey === capabilityNodeId)
      .filter((item) => item.validity.validityStatus === 'valid')
      .sort((left, right) => right.evidence.occurredAt - left.evidence.occurredAt)
      .slice(0, limit)
      .map((item) => item.evidence);
  }

  async listAllValid(examCycleId: ExamCycleId): Promise<readonly LearningEvidenceRecord[]> {
    const values = await this.database.getAll<StoredEvidenceAggregate>(TutorIndexedDbStore.LearningEvidenceAggregates);
    return values
      .filter((item) => item.examCycleKey === examCycleId && item.validity.validityStatus === 'valid')
      .sort((left, right) => right.evidence.occurredAt - left.evidence.occurredAt)
      .map((item) => item.evidence);
  }
}

function storedSession(facts: ObjectiveSessionFacts): StoredSessionFacts {
  return {
    ...facts,
    sessionId: facts.session.id,
    idempotencyKey: facts.session.idempotencyKey,
    examCycleKey: facts.session.examCycleId,
    threadKey: facts.session.learningThreadId
  };
}

function factsOf({ sessionId: _sessionId, idempotencyKey: _idempotencyKey, examCycleKey: _examCycleKey, threadKey: _threadKey, ...facts }: StoredSessionFacts): ObjectiveSessionFacts {
  return facts;
}

function storedEvidence(
  evidence: LearningEvidenceRecord,
  validity: EvidenceValidityProjection,
  corrections: readonly EvidenceCorrectionRecord[]
): StoredEvidenceAggregate {
  return {
    evidenceId: evidence.id,
    idempotencyKey: evidence.idempotencyKey,
    examCycleKey: evidence.examCycleId,
    capabilityKey: evidence.capabilityNodeId,
    evidence,
    validity,
    corrections
  };
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError('Evidence query limit must be between 1 and 500');
}

function assertSessionLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('Learning session query limit must be between 1 and 500');
  }
}
