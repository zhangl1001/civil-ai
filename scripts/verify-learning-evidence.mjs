import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, '../web');
const server = await createServer({
  root: webRoot,
  configFile: false,
  resolve: { alias: { '@': path.join(webRoot, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

async function verify() {
try {
  const [evidence, teaching, curriculum] = await Promise.all([
    server.ssrLoadModule('/src/modules/evidence/public.ts'),
    server.ssrLoadModule('/src/modules/teaching/public.ts'),
    server.ssrLoadModule('/src/modules/curriculum/public.ts')
  ]);
  const clock = new TestClock();
  const ids = new TestIds();
  const unitOfWork = { run: async (work) => work({ transactionId: `tx:${clock.now()}` }) };
  const curriculumBundle = curriculum.createBundledNationalCurriculum();
  const candidateRepository = { findCycle: async (id) => id === 'cycle:test' ? candidateCycle(curriculumBundle.curriculum.id) : undefined };
  const curriculumRepository = { findBundle: async (id) => id === curriculumBundle.curriculum.id ? curriculumBundle : undefined };
  const threadRepository = new MemoryThreadRepository();
  const sessionRepository = new MemorySessionRepository();
  const diagnosisRepository = new MemoryDiagnosisRepository();
  const evidenceRepository = new MemoryEvidenceRepository();
  const outboxRepository = new MemoryOutboxRepository();
  const contentRepository = { findQuestionSet: async (id) => id === 'question-set:test' ? questionSet() : undefined };

  const createThread = new teaching.CreateLearningThread(
    unitOfWork, threadRepository, candidateRepository, curriculumRepository, outboxRepository, clock, ids
  );
  const thread = await createThread.execute({
    idempotencyKey: 'thread:weakening:create',
    examCycleId: 'cycle:test',
    capabilityNodeId: 'capability:aptitude:judgment:weaken',
    originType: teaching.LearningThreadOrigin.Diagnosis,
    goal: '建立削弱论证的独立作答能力',
    gapSnapshot: { source: 'initial_diagnosis', confidence: 0.4 },
    initialStage: teaching.LearningThreadStage.Diagnose,
    exitCriteria: { independentCorrectRate: 0.8 }
  });
  const duplicateThread = await createThread.execute({
    idempotencyKey: 'thread:weakening:create',
    examCycleId: 'cycle:test',
    capabilityNodeId: 'capability:aptitude:judgment:weaken',
    originType: teaching.LearningThreadOrigin.Diagnosis,
    goal: '建立削弱论证的独立作答能力',
    gapSnapshot: {},
    initialStage: teaching.LearningThreadStage.Diagnose,
    exitCriteria: {}
  });
  assert.equal(duplicateThread.thread.id, thread.thread.id, 'open learning thread creation must be idempotent');

  const transition = new teaching.TransitionLearningThread(unitOfWork, threadRepository, outboxRepository, clock, ids);
  const advanced = await transition.execute({
    idempotencyKey: 'thread:weakening:diagnose-to-teach',
    learningThreadId: thread.thread.id,
    action: teaching.LearningThreadAction.Advance,
    nextStage: teaching.LearningThreadStage.Teach,
    reasonCode: 'diagnosis.complete',
    nextAction: { action: 'explain_argument_structure' }
  });
  assert.equal(advanced.thread.stage, teaching.LearningThreadStage.Teach);
  const repeatedTransition = await transition.execute({
    idempotencyKey: 'thread:weakening:diagnose-to-teach',
    learningThreadId: thread.thread.id,
    action: teaching.LearningThreadAction.Advance,
    nextStage: teaching.LearningThreadStage.Teach,
    reasonCode: 'diagnosis.complete'
  });
  assert.equal(repeatedTransition.thread.version, advanced.thread.version, 'thread transition must not apply twice');

  const submit = new evidence.SubmitObjectiveSession(
    unitOfWork,
    contentRepository,
    threadRepository,
    sessionRepository,
    diagnosisRepository,
    evidenceRepository,
    outboxRepository,
    clock,
    ids
  );
  const command = {
    idempotencyKey: 'session:weakening:1',
    learningThreadId: thread.thread.id,
    questionSetId: 'question-set:test',
    startedAt: 1_784_016_010_000,
    elapsedMs: 41_000,
    answers: [{
      questionId: 'question:test:1',
      optionId: 'A',
      elapsedMs: 41_000,
      confidence: 0.8,
      hintLevel: 0,
      answerChangeCount: 1,
      observations: [{
        observationType: 'method_selection',
        valueCode: 'alternative_cause_not_checked',
        value: { selectedMethod: 'correlation_only' },
        confidence: 0.7
      }]
    }]
  };
  const result = await submit.execute(command);
  assert.deepEqual(
    { total: result.total, answered: result.answered, correct: result.correct, incorrect: result.incorrect, unanswered: result.unanswered, diagnosisCount: result.diagnosisCount },
    { total: 1, answered: 1, correct: 0, incorrect: 1, unanswered: 0, diagnosisCount: 1 }
  );
  const savedFacts = await sessionRepository.findById(result.sessionId);
  assert.equal(savedFacts.attempts[0].result, evidence.AttemptResult.Incorrect);
  assert.equal(savedFacts.gradings[0].gradingMethod, evidence.GradingMethod.Deterministic);
  const diagnoses = await diagnosisRepository.listBySession(result.sessionId);
  assert.equal(diagnoses[0].causeCode, evidence.ErrorCauseCode.Unknown);
  assert.match(diagnoses[0].detail, /不能直接归因为/);
  const confirmDiagnosis = new evidence.ConfirmErrorDiagnosis(
    unitOfWork, diagnosisRepository, outboxRepository, clock, ids
  );
  const confirmed = await confirmDiagnosis.execute({
    idempotencyKey: 'diagnosis:weakening:confirm:1',
    diagnosisId: diagnoses[0].id,
    action: evidence.ErrorDiagnosisConfirmationAction.Correct,
    actorType: 'user',
    correctedCauseCode: evidence.ErrorCauseCode.MethodSelectionError,
    correctedDetail: '能识别削弱题，但没有检验替代原因是否比题干因果链更直接。'
  });
  assert.equal(confirmed.confirmationStatus, 'corrected');
  assert.equal(confirmed.effectiveCauseCode, evidence.ErrorCauseCode.MethodSelectionError);
  const repeatedConfirmation = await confirmDiagnosis.execute({
    idempotencyKey: 'diagnosis:weakening:confirm:1',
    diagnosisId: diagnoses[0].id,
    action: evidence.ErrorDiagnosisConfirmationAction.Correct,
    actorType: 'user',
    correctedCauseCode: evidence.ErrorCauseCode.MethodSelectionError,
    correctedDetail: '重复请求不应创建第二条确认事实。'
  });
  assert.equal(repeatedConfirmation.version, 1, 'diagnosis confirmation must be idempotent');
  const validEvidence = await evidenceRepository.listValid('cycle:test', 'capability:aptitude:judgment:weaken', 10);
  assert.equal(validEvidence.length, 1);
  assert.equal(validEvidence[0].weight, 0.6);
  assert.equal(evidence.objectiveEvidencePolicyV1.correctnessWeight(evidence.AssessmentRole.Practice, 2), 0.42);
  const repeatedSubmission = await submit.execute(command);
  assert.equal(repeatedSubmission.sessionId, result.sessionId, 'objective submission must be idempotent');
  assert.equal(repeatedSubmission.diagnosisCount, 1);

  const correctEvidence = new evidence.CorrectLearningEvidence(
    unitOfWork, evidenceRepository, outboxRepository, clock, ids
  );
  await correctEvidence.execute({
    idempotencyKey: 'evidence:weakening:invalidate:1',
    evidenceId: validEvidence[0].id,
    action: evidence.EvidenceCorrectionAction.Invalidate,
    reasonCode: 'question.quality_rejected',
    actorType: 'user'
  });
  assert.equal((await evidenceRepository.listValid('cycle:test', 'capability:aptitude:judgment:weaken', 10)).length, 0);
  await correctEvidence.execute({
    idempotencyKey: 'evidence:weakening:invalidate:1',
    evidenceId: validEvidence[0].id,
    action: evidence.EvidenceCorrectionAction.Invalidate,
    reasonCode: 'question.quality_rejected',
    actorType: 'user'
  });
  assert.equal((await evidenceRepository.findValidity(validEvidence[0].id)).validityStatus, evidence.EvidenceValidity.Invalid);
  assert.equal(outboxRepository.events.filter((item) => item.eventType === 'learning_session.objective_submitted').length, 1);
  assert.equal(outboxRepository.events.filter((item) => item.eventType === 'error_diagnosis.confirmed').length, 1);
  console.log('Learning evidence verification passed.');
} finally {
  await server.close();
}
}

class TestClock {
  value = 1_784_016_000_000;
  now() { return ++this.value; }
  monotonicNowMs() { return ++this.value; }
}

class TestIds {
  sequence = 0;
  next(namespace) { return `${namespace}:test:${++this.sequence}`; }
}

class MemoryThreadRepository {
  threads = new Map();
  events = new Map();
  async create(thread, event) {
    if (await this.findOpen(thread.examCycleId, thread.primaryCapabilityNodeId)) throw new Error('open thread exists');
    this.threads.set(thread.id, { thread, events: [event] });
    this.events.set(event.idempotencyKey, event);
  }
  async replace(thread, expectedVersion, event) {
    const current = this.threads.get(thread.id);
    if (!current || current.thread.version !== expectedVersion || thread.version !== expectedVersion + 1) throw new Error('thread version conflict');
    this.threads.set(thread.id, { thread, events: [...current.events, event] });
    this.events.set(event.idempotencyKey, event);
  }
  async findById(id) { return this.threads.get(id); }
  async findOpen(cycleId, capabilityId) {
    return [...this.threads.values()].find((item) => item.thread.examCycleId === cycleId && item.thread.primaryCapabilityNodeId === capabilityId && ['active', 'paused'].includes(item.thread.status));
  }
  async findEventByIdempotencyKey(key) { return this.events.get(key); }
}

class MemorySessionRepository {
  byId = new Map();
  byKey = new Map();
  async commitObjectiveSession(facts) {
    if (this.byKey.has(facts.session.idempotencyKey)) throw new Error('session duplicate');
    this.byId.set(facts.session.id, facts);
    this.byKey.set(facts.session.idempotencyKey, facts.session.id);
  }
  async findByIdempotencyKey(key) { const id = this.byKey.get(key); return id ? this.byId.get(id) : undefined; }
  async findById(id) { return this.byId.get(id); }
}

class MemoryDiagnosisRepository {
  values = [];
  confirmations = new Map();
  projections = new Map();
  async append(values) { this.values.push(...values); }
  async listBySession(sessionId) { return this.values.filter((item) => item.sessionId === sessionId); }
  async find(id) { return this.values.find((item) => item.id === id); }
  async findByIdempotencyKey(key) { return this.values.find((item) => item.idempotencyKey === key); }
  async appendConfirmation(confirmation, projection, expectedVersion) {
    const current = this.projections.get(confirmation.diagnosisId);
    if (current?.version !== expectedVersion || projection.version !== (expectedVersion ?? 0) + 1) {
      throw new Error('diagnosis projection version conflict');
    }
    this.confirmations.set(confirmation.idempotencyKey, confirmation);
    this.projections.set(confirmation.diagnosisId, projection);
  }
  async findConfirmationByIdempotencyKey(key) { return this.confirmations.get(key); }
  async findCurrentProjection(id) { return this.projections.get(id); }
}

class MemoryEvidenceRepository {
  values = new Map();
  corrections = new Map();
  async append(values, projections) {
    for (const evidence of values) {
      const validity = projections.find((item) => item.evidenceId === evidence.id);
      this.values.set(evidence.id, { evidence, validity });
    }
  }
  async appendCorrection(correction, validity, expectedVersion) {
    const current = this.values.get(correction.evidenceId);
    if (!current || current.validity.version !== expectedVersion) throw new Error('evidence version conflict');
    current.validity = validity;
    this.corrections.set(correction.idempotencyKey, correction);
  }
  async find(id) { return this.values.get(id)?.evidence; }
  async findValidity(id) { return this.values.get(id)?.validity; }
  async findByIdempotencyKey(key) { return [...this.values.values()].find((item) => item.evidence.idempotencyKey === key)?.evidence; }
  async findCorrectionByIdempotencyKey(key) { return this.corrections.get(key); }
  async listValid(cycleId, capabilityId, limit) {
    return [...this.values.values()]
      .filter((item) => item.evidence.examCycleId === cycleId && item.evidence.capabilityNodeId === capabilityId && item.validity.validityStatus === 'valid')
      .slice(0, limit)
      .map((item) => item.evidence);
  }
}

class MemoryOutboxRepository {
  events = [];
  async append(event) {
    if (this.events.some((item) => item.idempotencyKey === event.idempotencyKey)) throw new Error('outbox duplicate');
    this.events.push(event);
  }
}

function candidateCycle(curriculumVersionId) {
  return { examCycle: { id: 'cycle:test', curriculumVersionId } };
}

function questionSet() {
  return {
    questionSet: {
      id: 'question-set:test',
      examCycleId: 'cycle:test',
      capabilityNodeId: 'capability:aptitude:judgment:weaken',
      assessmentRole: 'practice',
      status: 'ready'
    },
    questions: [{
      id: 'question:test:1',
      capabilityNodeId: 'capability:aptitude:judgment:weaken',
      contentVersion: 1,
      content: { options: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }] },
      correctAnswer: { optionId: 'B' }
    }]
  };
}

await verify();
