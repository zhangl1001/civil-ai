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
  const [evidence, teaching, curriculum, sqliteEvidence] = await Promise.all([
    server.ssrLoadModule('/src/modules/evidence/public.ts'),
    server.ssrLoadModule('/src/modules/teaching/public.ts'),
    server.ssrLoadModule('/src/modules/curriculum/public.ts'),
    server.ssrLoadModule('/src/modules/evidence/adapters/SqliteLearningFactRepositories.ts')
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
  let questionSetPracticeStatus = 'not_started';
  const contentRepository = {
    findQuestionSet: async (id) => id === 'question-set:test' ? questionSet() : undefined,
    async updateQuestionSetPracticeStatus(id, status) {
      if (id === 'question-set:test') questionSetPracticeStatus = status;
    }
  };
  let diagnosisListSql = '';
  const sqliteDiagnosisRepository = new sqliteEvidence.SqliteErrorDiagnosisRepository({
    async query(sql) {
      diagnosisListSql = sql;
      return [];
    }
  }, {});
  await sqliteDiagnosisRepository.listBySessions(['LearningSessionId:test']);
  assert.match(diagnosisListSql, /JOIN attempts attempt ON attempt\.id = diagnosis\.attempt_id/);
  assert.match(diagnosisListSql, /WHERE attempt\.session_id IN/);

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
    questionIds: ['question:test:1'],
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
        confidence: 0.7,
        score: 0.35
      }]
    }]
  };
  const result = await submit.execute(command);
  assert.equal(result.rootAgentRunId, 'AgentRunId:generation-root');
  assert.deepEqual(
    { total: result.total, answered: result.answered, correct: result.correct, incorrect: result.incorrect, unanswered: result.unanswered, diagnosisCount: result.diagnosisCount },
    { total: 1, answered: 1, correct: 0, incorrect: 1, unanswered: 0, diagnosisCount: 1 }
  );
  const savedFacts = await sessionRepository.findById(result.sessionId);
  assert.equal(savedFacts.attempts[0].result, evidence.AttemptResult.Incorrect);
  assert.equal(savedFacts.gradings[0].gradingMethod, evidence.GradingMethod.Deterministic);
  assert.equal(questionSetPracticeStatus, 'completed', 'submitting a session must complete the question-set practice lifecycle');
  const diagnoses = await diagnosisRepository.listBySession(result.sessionId);
  assert.equal(diagnoses[0].causeCode, evidence.ErrorCauseCode.Unknown);
  assert.match(diagnoses[0].detail, /不能直接归因为/);
  const confirmedDiagnosisRefreshes = [];
  const confirmDiagnosis = new evidence.ConfirmErrorDiagnosis(
    unitOfWork,
    diagnosisRepository,
    evidenceRepository,
    { async execute(input) { confirmedDiagnosisRefreshes.push(input.capabilityNodeId); } },
    outboxRepository,
    clock,
    ids
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
  assert.deepEqual(confirmedDiagnosisRefreshes, ['capability:aptitude:judgment:weaken']);
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
  assert.equal(validEvidence.length, 5);
  const correctnessEvidence = validEvidence.find((item) => item.evidenceType === evidence.EvidenceType.Correctness);
  assert.equal(correctnessEvidence?.weight, 0.42);
  assert.equal(validEvidence.some((item) => item.evidenceType === evidence.EvidenceType.Speed), true);
  assert.equal(validEvidence.filter((item) => item.evidenceType === evidence.EvidenceType.MethodRecognition).length, 2);
  assert.equal(validEvidence.some((item) => item.evidenceType === evidence.EvidenceType.UserConfirmation), true);
  assert.equal(evidence.objectiveEvidencePolicyV2.correctnessWeight(
    evidence.AssessmentRole.Practice,
    2,
    evidence.ObjectiveEvidenceOrigin.AiTraining
  ), 0.29);
  const refreshedSubjectiveCapabilities = [];
  const recordSubjective = new evidence.RecordSubjectiveAssessment(
    unitOfWork,
    evidenceRepository,
    { async execute(input) { refreshedSubjectiveCapabilities.push(input.capabilityNodeId); } },
    clock,
    ids
  );
  const subjectiveCommand = {
    examCycleId: 'cycle:test',
    sourceAssetId: 'essay-attempt:1',
    rubricVersion: 'essay_rubric@1.0.0',
    dimensions: [
      { capabilityNodeId: 'capability:essay:material', dimensionKey: 'relevance', score: 0.7, confidence: 0.8, metadata: {} },
      { capabilityNodeId: 'capability:essay:material', dimensionKey: 'evidence_extraction', score: 0.5, confidence: 0.8, metadata: {} }
    ]
  };
  const subjectiveEvidence = await recordSubjective.execute(subjectiveCommand);
  assert.equal(subjectiveEvidence.length, 2, 'rubric dimensions sharing one capability must remain independent evidence');
  assert.equal(new Set(subjectiveEvidence.map((item) => item.idempotencyKey)).size, 2);
  assert.deepEqual(refreshedSubjectiveCapabilities, ['capability:essay:material']);
  assert.deepEqual(
    (await recordSubjective.execute(subjectiveCommand)).map((item) => item.id),
    subjectiveEvidence.map((item) => item.id),
    'subjective rubric evidence must remain idempotent per dimension'
  );
  const repeatedSubmission = await submit.execute(command);
  assert.equal(repeatedSubmission.sessionId, result.sessionId, 'objective submission must be idempotent');
  assert.equal(repeatedSubmission.rootAgentRunId, result.rootAgentRunId);
  assert.equal(repeatedSubmission.diagnosisCount, 1);
  let diagnosisModelInvocations = 0;
  const diagnosisTransitions = [];
  const secondProvisional = {
    ...diagnoses[0],
    id: 'ErrorDiagnosisId:diagnosis:test:second',
    idempotencyKey: 'diagnosis:test:second',
    detail: '第二道错题的确定性证据不足。'
  };
  diagnosisRepository.values.push(secondProvisional);
  const runAiDiagnosis = new evidence.RunAiErrorDiagnosis(
    unitOfWork,
    diagnosisRepository,
    outboxRepository,
    {
      compile() {
        return {
          system: 'diagnose',
          user: '{}',
          responseSchema: {},
          version: 'test',
          promptCode: 'test',
          contentHash: 'test'
        };
      }
    },
    {
      async execute(invocation) {
        diagnosisModelInvocations += 1;
        return {
          invocationId: `invocation:diagnosis:${diagnosisModelInvocations}`,
          text: invocation.modelRole === 'error_diagnosis_batch'
            ? JSON.stringify({
                diagnoses: [
                  {
                    provisionalDiagnosisId: diagnoses[0].id,
                    causeCode: evidence.ErrorCauseCode.MethodSelectionError,
                    errorStage: 'option_comparison',
                    detail: '观察到误选项没有直接作用于题干论证链，更可能是在比较削弱力度时选择了较弱的方法。',
                    confidence: 0.5,
                    recommendedActionCode: 'practice_option_strength_comparison',
                    dimensions: [{
                      code: 'method_selection',
                      status: 'gap',
                      evidence: '误选项采用了较弱的削弱方式。'
                    }],
                    correctionPlan: {
                      objective: '学会比较削弱方式的直接性和强度。',
                      steps: ['标出论点与论据。', '逐项比较选项作用位置。'],
                      practiceFocus: '选项强度对比',
                      successCriteria: '连续三题能解释正确项更强的原因。'
                    }
                  },
                  {
                    provisionalDiagnosisId: secondProvisional.id,
                    causeCode: evidence.ErrorCauseCode.CarelessError,
                    detail: '这项置信度非法，应仅重试本题。',
                    confidence: 1,
                    recommendedActionCode: 'check_answer',
                    dimensions: [{
                      code: 'reasoning_process',
                      status: 'risk',
                      evidence: '测试用非法高置信度诊断。'
                    }],
                    correctionPlan: {
                      objective: '测试非法条目单独重试。',
                      steps: ['检查输入。', '重新诊断。'],
                      practiceFocus: '测试',
                      successCriteria: '仅重试当前条目。'
                    }
                  }
                ]
              })
            : JSON.stringify({
                causeCode: evidence.ErrorCauseCode.MethodSelectionError,
                errorStage: 'option_comparison',
                detail: '观察到误选项没有直接作用于题干论证链，更可能是在比较削弱力度时选择了较弱的方法。',
                confidence: 0.5,
                recommendedActionCode: 'practice_option_strength_comparison',
                dimensions: [{
                  code: 'method_selection',
                  status: 'gap',
                  evidence: '误选项采用了较弱的削弱方式。'
                }],
                correctionPlan: {
                  objective: '学会比较削弱方式的直接性和强度。',
                  steps: ['标出论点与论据。', '逐项比较选项作用位置。'],
                  practiceFocus: '选项强度对比',
                  successCriteria: '连续三题能解释正确项更强的原因。'
                }
              })
        };
      }
    },
    {
      async execute(transitionCommand) {
        diagnosisTransitions.push(transitionCommand);
      }
    },
    clock,
    ids
  );
  const diagnosisCommand = {
    agentRunId: 'AgentRunId:diagnosis:test',
    items: [{
      provisionalDiagnosisId: diagnoses[0].id,
      evidenceContext: { userAnswer: 'A', standardAnswer: 'B' },
      subject: '行测判断推理',
      capabilityName: '削弱论证'
    }, {
      provisionalDiagnosisId: secondProvisional.id,
      evidenceContext: { userAnswer: 'C', standardAnswer: 'D' },
      subject: '行测判断推理',
      capabilityName: '削弱论证'
    }]
  };
  const aiDiagnosisIds = await runAiDiagnosis.execute(diagnosisCommand, {});
  const repeatedAiDiagnosisIds = await runAiDiagnosis.execute(diagnosisCommand, {});
  assert.deepEqual(repeatedAiDiagnosisIds, aiDiagnosisIds);
  assert.equal(
    diagnosisModelInvocations,
    2,
    'a valid batch item must be committed while only the malformed sibling receives a single-item fallback'
  );
  assert.equal(
    diagnosisRepository.values.filter((item) => item.source === 'tutor_ai').length,
    2,
    'AI diagnosis retry must not append duplicate diagnosis facts'
  );
  const committedAiDiagnosis = diagnosisRepository.values.find((item) => item.source === 'tutor_ai');
  assert.equal(committedAiDiagnosis.dimensions[0].code, 'method_selection');
  assert.equal(committedAiDiagnosis.correctionPlan.steps.length, 2);
  assert.match(committedAiDiagnosis.correctionPlan.successCriteria, /连续三题/);
  assert.equal(diagnosisTransitions.length, 2, 'both the original execution and recovery path may idempotently complete the run');
  await assert.rejects(
    () => submit.execute({
      ...command,
      idempotencyKey: 'session:weakening:invalid-observation',
      answers: [{
        ...command.answers[0],
        observations: [{
          observationType: 'answer_interaction',
          valueCode: 'answer_changed',
          value: {},
          confidence: 1
        }]
      }]
    }),
    /observation type is invalid/
  );
  assert.equal(sessionRepository.byId.size, 1, 'invalid observations must fail before opening the submission transaction');

  const correctEvidence = new evidence.CorrectLearningEvidence(
    unitOfWork, evidenceRepository, outboxRepository, clock, ids
  );
  await correctEvidence.execute({
    idempotencyKey: 'evidence:weakening:invalidate:1',
    evidenceId: correctnessEvidence.id,
    action: evidence.EvidenceCorrectionAction.Invalidate,
    reasonCode: 'question.quality_rejected',
    actorType: 'user'
  });
  assert.equal((await evidenceRepository.listValid('cycle:test', 'capability:aptitude:judgment:weaken', 10)).length, 4);
  await correctEvidence.execute({
    idempotencyKey: 'evidence:weakening:invalidate:1',
    evidenceId: correctnessEvidence.id,
    action: evidence.EvidenceCorrectionAction.Invalidate,
    reasonCode: 'question.quality_rejected',
    actorType: 'user'
  });
  assert.equal((await evidenceRepository.findValidity(correctnessEvidence.id)).validityStatus, evidence.EvidenceValidity.Invalid);
  assert.equal(outboxRepository.events.filter((item) => item.eventType === 'learning_session.objective_submitted').length, 1);
  assert.equal(
    outboxRepository.events.find((item) => item.eventType === 'learning_session.objective_submitted')?.payload.rootAgentRunId,
    'AgentRunId:generation-root',
    'submission post-processing must remain correlated with the question-generation root task'
  );
  assert.equal(outboxRepository.events.filter((item) => item.eventType === 'error_diagnosis.confirmed').length, 1);
  const retentionSubset = await submit.execute({
    idempotencyKey: 'session:weakening:retention-subset',
    learningThreadId: thread.thread.id,
    questionSetId: 'question-set:test',
    questionIds: ['question:test:2'],
    assessmentRole: evidence.AssessmentRole.Retention,
    startedAt: 1_784_016_020_000,
    elapsedMs: 20_000,
    answers: [{
      questionId: 'question:test:2',
      optionId: 'D',
      elapsedMs: 20_000,
      answerChangeCount: 0
    }]
  });
  const retentionFacts = await sessionRepository.findById(retentionSubset.sessionId);
  assert.equal(retentionSubset.total, 1, 'wrong-book review must submit only the selected question subset');
  assert.equal(retentionFacts.session.sessionType, evidence.LearningSessionType.Retention);
  assert.equal(retentionFacts.attempts[0].questionId, 'question:test:2');
  assert.equal(outboxRepository.events.filter((item) => item.eventType === 'learning_session.objective_submitted').length, 2);
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
  async findMany(ids) { const wanted = new Set(ids); return this.values.filter((item) => wanted.has(item.id)); }
  async findByIdempotencyKey(key) { return this.values.find((item) => item.idempotencyKey === key); }
  async findByIdempotencyKeys(keys) { const wanted = new Set(keys); return this.values.filter((item) => wanted.has(item.idempotencyKey)); }
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
    generationSpec: {
      sourceAgentRunId: 'AgentRunId:generation-root',
      constraints: {}
    },
    questions: [{
      id: 'question:test:1',
      capabilityNodeId: 'capability:aptitude:judgment:weaken',
      contentVersion: 1,
      content: { options: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }] },
      correctAnswer: { optionId: 'B' }
    }, {
      id: 'question:test:2',
      capabilityNodeId: 'capability:aptitude:judgment:weaken',
      contentVersion: 1,
      content: { options: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }] },
      correctAnswer: { optionId: 'D' }
    }]
  };
}

await verify();
