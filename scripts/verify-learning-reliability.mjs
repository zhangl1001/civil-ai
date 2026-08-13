import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import ts from '../web/node_modules/typescript/lib/typescript.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '@': path.join(root, 'src') } },
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

try {
  const [indexedDb, evidence, swipe, practiceLibrary, practiceDraft, mutexModule, sqliteEvidence, sqliteScope] = await Promise.all([
    server.ssrLoadModule('/src/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork.ts'),
    server.ssrLoadModule('/src/modules/evidence/public.ts'),
    server.ssrLoadModule('/src/features/practice/QuestionSwipeNavigation.ts'),
    server.ssrLoadModule('/src/services/AIPracticeLibraryService.ts'),
    server.ssrLoadModule('/src/features/practice/PracticeSessionDraftService.ts'),
    server.ssrLoadModule('/src/capabilities/database/internal/AsyncMutex.ts'),
    server.ssrLoadModule('/src/modules/evidence/adapters/SqliteLearningFactRepositories.ts'),
    server.ssrLoadModule('/src/capabilities/database/adapters/sqlite/SqlTransactionScope.ts')
  ]);
  await verifyIndexedDbSerialization(indexedDb);
  await verifyMutexTimeoutRemovesWaiter(mutexModule);
  await verifyObjectiveSubmissionUsesSqlBatch(sqliteEvidence, sqliteScope);
  await verifyNativeDatabaseRecoveryPolicy();
  await verifyNoSqliteTransactionReentry();
  await verifyObjectiveOutbox(evidence);
  await verifyPostProcessingDependencyOrder(evidence);
  await verifyPostProcessingBatchesDiagnoses(evidence);
  verifyQuestionSwipe(swipe);
  await verifyPracticeLibraryProjection(practiceLibrary);
  await verifyPracticeDraftLifecycle(practiceDraft);
  console.log('Learning reliability verification passed.');
} finally {
  await server.close();
}

async function verifyNativeDatabaseRecoveryPolicy() {
  const [
    databaseSource,
    coordinatorSource,
    bootstrapSource,
    agentWorkerSource,
    submissionWorkerSource,
    proactiveWorkerSource
  ] = await Promise.all([
    readFile(path.join(root, 'src/capabilities/database/adapters/sqlite/CapacitorSqliteDatabase.ts'), 'utf8'),
    readFile(path.join(root, 'src/composition-root/database/TutorDatabaseLifecycleCoordinator.ts'), 'utf8'),
    readFile(path.join(root, 'src/services/AppBootstrap.ts'), 'utf8'),
    readFile(path.join(root, 'src/composition-root/agent/AgentWorkerCoordinator.ts'), 'utf8'),
    readFile(path.join(root, 'src/composition-root/evidence/ObjectiveSubmissionRecoveryCoordinator.ts'), 'utf8'),
    readFile(path.join(root, 'src/composition-root/proactive/ProactiveTutorCoordinator.ts'), 'utf8')
  ]);

  assert.match(databaseSource, /generation \+= 1/);
  assert.match(databaseSource, /this\.mutex = new AsyncMutex\(\)/);
  assert.match(databaseSource, /rollbackIfActive\(previousConnection\)/);
  assert.match(databaseSource, /configureConnection\(connection\)/);
  assert.match(databaseSource, /verifyConnectionHealth\(connection\)/);
  assert.match(databaseSource, /PRAGMA quick_check\(1\)/);
  assert.match(databaseSource, /connection\.replaced/);
  assert.match(databaseSource, /TutorDatabaseTransactionTimeoutError/);
  assert.match(databaseSource, /rollbackTransaction\(connection\)/);
  assert.match(coordinatorSource, /recoverAfterInterruption/);

  const lifecycleInstall = bootstrapSource.indexOf('tutorDatabaseLifecycleCoordinator.install(runtime)');
  const agentInstall = bootstrapSource.indexOf('agentWorkerCoordinator.install(runtime)');
  const submissionInstall = bootstrapSource.indexOf('objectiveSubmissionRecoveryCoordinator.install(runtime)');
  assert.ok(lifecycleInstall >= 0 && lifecycleInstall < agentInstall);
  assert.ok(lifecycleInstall < submissionInstall);
  assert.match(agentWorkerSource, /tutorDatabaseLifecycleCoordinator\.waitUntilReady\(\)/);
  assert.match(submissionWorkerSource, /tutorDatabaseLifecycleCoordinator\.waitUntilReady\(\)/);
  assert.match(proactiveWorkerSource, /tutorDatabaseLifecycleCoordinator\.waitUntilReady\(\)/);
}

async function verifyNoSqliteTransactionReentry() {
  const sourceRoot = path.join(root, 'src');
  const entries = await readdir(sourceRoot, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(entry.parentPath, entry.name));
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (!source.includes('TransactionContext') || !/this\.(database|db)\.query/.test(source)) continue;
    const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (
        (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isArrowFunction(node))
        && node.body
      ) {
        const text = node.getText(syntax);
        if (text.includes('TransactionContext') && /this\.(database|db)\.query/.test(text)) {
          const position = syntax.getLineAndCharacterOfPosition(node.getStart(syntax));
          violations.push(`${path.relative(root, file)}:${position.line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(syntax);
  }

  assert.deepEqual(
    violations,
    [],
    `SQLite repositories must query through the active transaction context: ${violations.join(', ')}`
  );
}

async function verifyMutexTimeoutRemovesWaiter(mutexModule) {
  const mutex = new mutexModule.AsyncMutex();
  let releaseOwner;
  let ownerStarted;
  const started = new Promise((resolve) => { ownerStarted = resolve; });
  const owner = mutex.runExclusive(async () => {
    ownerStarted();
    await new Promise((resolve) => { releaseOwner = resolve; });
  });
  await started;
  let abandonedWorkRan = false;
  await assert.rejects(
    mutex.runExclusive(async () => {
      abandonedWorkRan = true;
    }, { waitTimeoutMs: 10, timeoutMessage: 'lock wait expired' }),
    /lock wait expired/
  );
  releaseOwner();
  await owner;
  assert.equal(abandonedWorkRan, false, 'a timed-out database waiter must be removed from the mutex queue');
  assert.equal(await mutex.runExclusive(async () => 'healthy'), 'healthy');
}

async function verifyObjectiveSubmissionUsesSqlBatch(sqliteEvidence, sqliteScope) {
  const batches = [];
  const transaction = {
    async execute() {},
    async query() { return []; },
    async run() {
      throw new Error('objective submission must use native batch writes');
    },
    async runBatch(statements) {
      batches.push(statements);
      return { changes: statements.length };
    }
  };
  const scope = new sqliteScope.SqlTransactionScope();
  const context = scope.bind(transaction);
  const database = { async query() { return []; } };
  const sessions = new sqliteEvidence.SqliteLearningSessionRepository(database, scope);
  const diagnoses = new sqliteEvidence.SqliteErrorDiagnosisRepository(database, scope);
  const evidence = new sqliteEvidence.SqliteLearningEvidenceRepository(database, scope);
  const now = 10_000;
  await sessions.commitObjectiveSession({
    session: {
      id: 'session:batch', examCycleId: 'cycle:1', learningThreadId: 'thread:1',
      questionSetId: 'set:1', sessionType: 'practice', assessmentRole: 'practice',
      status: 'completed', startedAt: now - 1_000, completedAt: now, elapsedMs: 1_000,
      questionCount: 1, answeredCount: 1, correctCount: 0, idempotencyKey: 'submit:batch',
      version: 1, createdAt: now, updatedAt: now
    },
    exposures: [{
      id: 'exposure:1', examCycleId: 'cycle:1', learningThreadId: 'thread:1',
      sessionId: 'session:batch', questionId: 'question:1', exposureType: 'practice',
      answerExposed: false, occurredAt: now, idempotencyKey: 'exposure:1'
    }],
    attempts: [{
      id: 'attempt:1', sessionId: 'session:batch', questionId: 'question:1',
      examCycleId: 'cycle:1', capabilityNodeId: 'capability:1', learningThreadId: 'thread:1',
      assessmentRole: 'practice', questionContentVersion: 1, answer: { optionId: 'A' },
      result: 'incorrect', score: 0, hintLevel: 0, answerChangeCount: 0,
      submittedAt: now, idempotencyKey: 'attempt:1'
    }],
    observations: [{
      id: 'observation:1', attemptId: 'attempt:1', observationType: 'method_selection',
      valueCode: 'unknown', value: {}, source: 'user', confidence: 0.5, occurredAt: now
    }],
    gradings: [{
      id: 'grading:1', attemptId: 'attempt:1', gradingMethod: 'deterministic',
      graderVersion: 'objective-single-choice:v1', result: 'incorrect', score: 0,
      normalizedFeedback: {}, confidence: 1, confirmationStatus: 'not_required',
      createdAt: now, idempotencyKey: 'grading:1'
    }]
  }, context);
  await diagnoses.append([{
    id: 'diagnosis:1', sessionId: 'session:batch', gradingResultId: 'grading:1',
    attemptId: 'attempt:1', examCycleId: 'cycle:1', capabilityNodeId: 'capability:1',
    causeCode: 'unknown', detail: '待分析', confidence: 0.15, confirmationStatus: 'pending',
    recommendedActionCode: 'request_error_diagnosis', source: 'deterministic',
    createdAt: now, idempotencyKey: 'diagnosis:1'
  }], context);
  await evidence.append([{
    id: 'evidence:1', examCycleId: 'cycle:1', capabilityNodeId: 'capability:1',
    attemptId: 'attempt:1', assessmentRole: 'practice', evidenceType: 'correctness',
    value: 0, weight: 1, quality: 1, source: 'deterministic_grader',
    validationPolicyVersion: 'v1', occurredAt: now, idempotencyKey: 'evidence:1', metadata: {}
  }], [{
    evidenceId: 'evidence:1', validityStatus: 'valid', updatedAt: now, version: 1
  }], context);
  scope.release(context);
  assert.deepEqual(batches.map((batch) => batch.length), [5, 1, 2]);
}

async function verifyPracticeDraftLifecycle(practiceDraft) {
  let saved;
  let practiceStatus = 'not_started';
  const runtime = {
    unitOfWork: {
      async runAutocommit(work) {
        return work({});
      }
    },
    candidateRepository: {
      async findCurrentCycle() {
        return { examCycle: { id: 'cycle:1' } };
      }
    },
    learningAssetStore: {
      async saveDraft(command) {
        saved = { ...command, status: 'draft' };
      },
      async findLatest(cycleId, kind, businessKey) {
        assert.equal(cycleId, 'cycle:1');
        assert.equal(kind, 'practice_session_draft');
        assert.equal(businessKey, 'question-set:set:draft');
        return saved;
      },
      async retireBusinessKey() {
        saved = saved ? { ...saved, status: 'retired' } : undefined;
      }
    },
    contentRepository: {
      async updateQuestionSetPracticeStatus(questionSetId, status) {
        assert.equal(questionSetId, 'set:draft');
        practiceStatus = status;
      }
    }
  };
  const service = new practiceDraft.PracticeSessionDraftService();
  const draftBundle = {
    questions: [{
      id: 'question:1',
      content: { options: [{ id: 'A' }, { id: 'B' }] }
    }, {
      id: 'question:multi',
      content: { options: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] }
    }]
  };
  await service.save(runtime, { questionSetId: 'set:draft' }, {
    answers: {
      'question:1': ['B'],
      'question:multi': ['A', 'C'],
      'question:removed': ['A']
    },
    elapsedByQuestion: { 'question:1': 1_200 },
    answerChanges: { 'question:1': 1 },
    currentQuestionId: 'question:1',
    elapsedMs: 5_000,
    currentQuestionElapsedMs: 800,
    remainingSeconds: 295,
    updatedAt: 10_000
  });
  const restored = await service.load(runtime, { questionSetId: 'set:draft' }, draftBundle);
  assert.equal(practiceStatus, 'in_progress');
  // Multi-answer selections survive; answers to questions that no longer exist do not.
  assert.deepEqual(restored.answers, { 'question:1': ['B'], 'question:multi': ['A', 'C'] });
  assert.equal(restored.currentQuestionId, 'question:1');
  assert.equal(restored.remainingSeconds, 295);
  await service.clear(runtime, { questionSetId: 'set:draft' });
  assert.equal(await service.load(runtime, { questionSetId: 'set:draft' }, draftBundle), undefined);
}

function verifyQuestionSwipe(swipe) {
  assert.equal(swipe.resolveQuestionSwipe({ deltaX: -72, deltaY: 12, durationMs: 240 }), 1);
  assert.equal(swipe.resolveQuestionSwipe({ deltaX: 68, deltaY: 8, durationMs: 260 }), -1);
  assert.equal(swipe.resolveQuestionSwipe({ deltaX: 32, deltaY: 4, durationMs: 180 }), 0);
  assert.equal(swipe.resolveQuestionSwipe({ deltaX: -70, deltaY: 96, durationMs: 220 }), 0);
  assert.equal(swipe.resolveQuestionSwipe({ deltaX: -80, deltaY: 4, durationMs: 1_200 }), 0);
}

async function verifyPracticeLibraryProjection(practiceLibrary) {
  const now = Date.now();
  const today = bundle('set:today', 'thread:today', 'capability:today', 'tutor', 8, now - 5_000);
  const previous = bundle('set:previous', 'thread:previous', 'capability:previous', 'self', 5, now - 86_400_000);
  const service = new practiceLibrary.AIPracticeLibraryService();
  const runtime = {
    candidateRepository: {
      async findCurrentCycle() {
        return {
          examCycle: { id: 'cycle:1', curriculumVersionId: 'curriculum:1' }
        };
      }
    },
    contentRepository: {
      async listQuestionSetLibrary(cycleId, limit) {
        assert.equal(cycleId, 'cycle:1');
        assert.equal(limit, 100);
        return [libraryEntry(today), libraryEntry(previous)];
      },
      async findQuestionSet(id) {
        return id === today.questionSet.id ? today : undefined;
      }
    },
    getAgentRunViews: {
      async execute() {
        return [{
          id: 'run:active',
          targetResourceType: 'structured_practice',
          isActive: true,
          scopeKey: 'practice:tutor:capability:today',
          actionParams: { mode: 'tutor' },
          title: '正在生成今日练习',
          detail: '判断推理 · 8题',
          status: 'running',
          statusText: '执行中',
          updatedAt: now
        }];
      }
    },
    curriculumRepository: {
      async findBundle() {
        return {
          capabilityNodes: [
            { id: 'capability:today', name: '论证结构' },
            { id: 'capability:previous', name: '资料速算' }
          ]
        };
      }
    },
    learningSessionRepository: {
      async listByQuestionSet(questionSetId, limit) {
        assert.equal(questionSetId, 'set:today');
        assert.equal(limit, 5);
        return [{
          session: {
            id: 'session:today',
            status: 'completed',
            completedAt: now,
            answeredCount: 8,
            correctCount: 6,
            questionCount: 8
          }
        }];
      }
    }
  };
  const snapshot = await service.read(runtime, {
    scope: 'today',
    entryMode: 'tutor',
    limit: 5
  });
  assert.equal(snapshot.readySetCount, 1);
  assert.equal(snapshot.readyQuestionCount, 8);
  assert.equal(snapshot.librarySetCount, 1);
  assert.equal(snapshot.activeTaskCount, 1);
  assert.equal(snapshot.sets[0].questionSetId, 'set:today');
  assert.equal(snapshot.sets[0].capabilityName, '论证结构');
  assert.equal('questions' in snapshot.sets[0], false);
  assert.equal(JSON.stringify(snapshot).includes('题目正文'), false);
  const filteredEmpty = await service.read(runtime, {
    scope: 'today',
    entryMode: 'self',
    limit: 5
  });
  assert.equal(filteredEmpty.readySetCount, 0);
  assert.equal(filteredEmpty.librarySetCount, 1);
  assert.equal(filteredEmpty.availableOutsideScope, true);
  const overview = await service.readQuestionSet(runtime, {
    questionSetId: today.questionSet.id,
    section: 'overview'
  });
  assert.equal(overview.overview.questionSetId, today.questionSet.id);
  assert.equal(overview.overview.recentSessions[0].sessionId, 'session:today');
  assert.equal('questions' in overview, false);

  const activeSnapshot = await service.read({
    candidateRepository: {
      async findCurrentCycle() {
        return {
          examCycle: { id: 'cycle:1', curriculumVersionId: 'curriculum:1' }
        };
      }
    },
    contentRepository: {
      async listQuestionSetLibrary() {
        throw new Error('Active-only query must not read question sets');
      }
    },
    getAgentRunViews: {
      async execute() {
        return [{
          id: 'run:active',
          targetResourceType: 'structured_practice',
          isActive: true,
          scopeKey: 'practice:tutor:capability:today',
          actionParams: { mode: 'tutor' },
          title: '正在生成今日练习',
          detail: '判断推理 · 8题',
          status: 'running',
          statusText: '执行中',
          updatedAt: now
        }];
      }
    },
    curriculumRepository: {
      async findBundle() {
        throw new Error('Active-only query must not read curriculum metadata');
      }
    }
  }, {
    scope: 'active',
    entryMode: 'tutor'
  });
  assert.equal(activeSnapshot.readySetCount, 0);
  assert.equal(activeSnapshot.activeTaskCount, 1);
}

function bundle(id, learningThreadId, capabilityNodeId, entryMode, questionCount, createdAt) {
  return {
    generationSpec: { constraints: { entryMode } },
    questionSet: {
      id,
      examCycleId: 'cycle:1',
      learningThreadId,
      capabilityNodeId,
      purpose: 'practice',
      assessmentRole: 'practice',
      module: entryMode === 'tutor' ? 'judgment' : 'data_analysis',
      questionCount,
      createdAt
    }
  };
}

function libraryEntry(value) {
  return {
    id: value.questionSet.id,
    examCycleId: 'cycle:1',
    learningThreadId: value.questionSet.learningThreadId,
    capabilityNodeId: value.questionSet.capabilityNodeId,
    purpose: 'practice',
    assessmentRole: 'practice',
    module: value.questionSet.module,
    questionCount: value.questionSet.questionCount,
    entryMode: value.generationSpec.constraints.entryMode,
    createdAt: value.questionSet.createdAt
  };
}

async function verifyIndexedDbSerialization(indexedDb) {
  const order = [];
  const scope = new indexedDb.IndexedDbTransactionScope();
  const database = {
    async writeBatch(operations) {
      order.push(`commit:${operations[0].value}`);
    }
  };
  const unitOfWork = new indexedDb.IndexedDbUnitOfWork(database, scope);
  await Promise.all([
    unitOfWork.run(async (context) => {
      order.push('first:start');
      scope.stage(context, { type: 'put', store: 'test', value: 'first' });
      await delay(20);
      order.push('first:end');
    }),
    unitOfWork.run(async (context) => {
      order.push('second:start');
      scope.stage(context, { type: 'put', store: 'test', value: 'second' });
      order.push('second:end');
    })
  ]);
  assert.deepEqual(order, [
    'first:start',
    'first:end',
    'commit:first',
    'second:start',
    'second:end',
    'commit:second'
  ], 'IndexedDB unit of work must serialize reads, staged writes, and commit as one critical section');
}

async function verifyObjectiveOutbox(evidence) {
  const calls = [];
  const clock = { value: 10_000, now() { return ++this.value; } };
  const event = {
    id: 'outbox:1',
    aggregateType: 'learning_session',
    aggregateId: 'session:1',
    eventType: 'learning_session.objective_submitted',
    payload: { sessionId: 'session:1', elapsedMs: 65_000 },
    occurredAt: 9_000,
    attemptCount: 0,
    idempotencyKey: 'practice:1:submitted'
  };
  const outbox = {
    async claimPending(options) {
      calls.push(['claim', options]);
      return [event];
    },
    async markPublished(id, workerId) {
      calls.push(['published', id, workerId]);
      return true;
    },
    async recordFailure() {
      throw new Error('success path must not record an outbox failure');
    }
  };
  const processor = {
    async execute(command) {
      calls.push(['process', command]);
      return { diagnosisRunIds: [], pendingSteps: [] };
    }
  };
  const worker = new evidence.ProcessObjectiveSubmissionOutbox(outbox, processor, clock);
  const result = await worker.execute('worker:1');
  assert.deepEqual(result, { claimed: 1, completed: 1, retried: 0 });
  assert.deepEqual(calls[0][1].eventTypes, ['learning_session.objective_submitted']);
  assert.equal(calls[1][1].idempotencyKey, event.idempotencyKey);
  assert.deepEqual(calls[2], ['published', event.id, 'worker:1']);
}

async function verifyPostProcessingDependencyOrder(evidence) {
  const downstream = [];
  const processor = new evidence.ObjectiveSubmissionPostProcessor(
    {
      async execute() {
        return {
          session: {
            id: 'session:1',
            examCycleId: 'cycle:1',
            questionCount: 1,
            answeredCount: 1,
            correctCount: 1
          },
          items: [{
            attempt: {
              capabilityNodeId: 'capability:1',
              examCycleId: 'cycle:1'
            },
            grading: { result: 'correct' },
            diagnoses: []
          }]
        };
      }
    },
    { async execute() { throw new Error('correct answer must not request diagnosis'); } },
    { async execute() { throw new Error('projection temporarily unavailable'); } },
    undefined,
    undefined,
    { async execute() { downstream.push('rebalance'); } },
    { async execute() { downstream.push('proactive'); } }
  );
  const result = await processor.execute({
    idempotencyKey: 'submission:1',
    sessionId: 'session:1',
    elapsedMs: 30_000
  });
  assert.equal(result.pendingSteps.includes('mastery.refresh'), true);
  assert.equal(result.pendingSteps.includes('daily_plan.rebalance'), true);
  assert.equal(result.pendingSteps.includes('proactive_tutor.refresh'), true);
  assert.deepEqual(downstream, [], 'plan and proactive work must wait for a successful mastery projection');
}

async function verifyPostProcessingBatchesDiagnoses(evidence) {
  const requests = [];
  const items = [1, 2].map((index) => ({
    question: { id: `question:${index}` },
    attempt: {
      capabilityNodeId: 'capability:1',
      examCycleId: 'cycle:1'
    },
    grading: { result: 'incorrect' },
    diagnoses: [{
      id: `diagnosis:${index}`,
      source: 'deterministic',
      causeCode: evidence.ErrorCauseCode.Unknown
    }]
  }));
  const processor = new evidence.ObjectiveSubmissionPostProcessor(
    {
      async execute() {
        return {
          session: {
            id: 'session:batch',
            examCycleId: 'cycle:1',
            questionCount: 2,
            answeredCount: 2,
            correctCount: 0
          },
          items
        };
      }
    },
    {
      async execute(command) {
        requests.push(command);
        return { run: { id: 'agent-run:batch' } };
      }
    }
  );
  const result = await processor.execute({
    idempotencyKey: 'submission:batch',
    sessionId: 'session:batch',
    elapsedMs: 60_000
  }, {
    'question:1': { userAnswer: 'A' },
    'question:2': { userAnswer: 'B' }
  });
  assert.equal(requests.length, 1, 'one submission must enqueue one diagnosis AgentRun');
  assert.equal(requests[0].items.length, 2, 'all incorrect items must share the diagnosis batch');
  assert.equal(requests[0].sessionId, 'session:batch');
  assert.deepEqual(result.diagnosisRunIds, ['agent-run:batch']);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
