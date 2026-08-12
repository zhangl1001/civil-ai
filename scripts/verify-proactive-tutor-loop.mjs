import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

try {
  const [tutoring, agent, planNavigation] = await Promise.all([
    server.ssrLoadModule('/src/modules/tutoring/public.ts'),
    server.ssrLoadModule('/src/modules/agent/public.ts'),
    server.ssrLoadModule('/src/features/planning/DailyPlanNavigation.ts')
  ]);
  assert(agent.tutorToolCatalog.some((tool) => tool.name === 'tutor.read_daily_context'));
  assert.equal(planNavigation.dailyPlanItemLocation(planItem('lecture')).path, '/vue/study/lecture');
  assert.equal(planNavigation.dailyPlanItemLocation(planItem('diagnosis')).path, '/vue/diagnosis');
  const essayLocation = planNavigation.dailyPlanItemLocation(planItem('essay'));
  assert.equal(essayLocation.path, '/vue/practice');
  assert.equal(essayLocation.query.subject, 'essay');
  assert.equal(essayLocation.query.mode, 'tutor');
  assert.equal(planNavigation.dailyPlanItemLocation(planItem('mock')).path, '/vue/exam');
  assert.equal(planNavigation.dailyPlanItemLocation(planItem('digest')).path, '/vue/digest');
  const practiceLocation = planNavigation.dailyPlanItemLocation(planItem('review'));
  assert.equal(practiceLocation.path, '/vue/practice');
  assert.equal(practiceLocation.query.dailyPlanItemId, 'DailyPlanItemId:navigation');
  assert.equal(practiceLocation.query.start, '1');

  const now = 1_785_100_000_000;
  const clock = { now: () => now, monotonicNowMs: () => 1 };
  const cycle = candidateCycle();
  const curriculum = curriculumBundle();
  const conclusions = [];
  const repository = {
    findByIdempotencyKey(key) { return Promise.resolve(conclusions.find((item) => item.idempotencyKey === key)); },
    findLatestBySession(sessionId) {
      return Promise.resolve([...conclusions].reverse().find((item) => item.learningSessionId === sessionId));
    },
    listRecent() { return Promise.resolve([...conclusions].reverse()); },
    append(value) { conclusions.push(value); return Promise.resolve(); }
  };
  const tracks = [masteryTrack()];
  const reviews = [reviewItem()];
  const plan = dailyPlan();
  const facts = objectiveFacts();
  const contentBundle = { questionSet: { originType: 'official' } };
  const candidates = { findCurrentCycle: async () => cycle, findCycle: async () => cycle };
  const curriculums = { findBundle: async () => curriculum };
  const mastery = {
    listPriorityTracks: async (_cycle, limit) => tracks.slice(0, limit),
    listDueReviews: async (_cycle, _now, limit) => reviews.slice(0, limit),
    listReviews: async (_cycle, limit) => reviews.slice(0, limit),
    findTrack: async () => tracks[0]
  };
  const learnerPriorities = {
    execute: async () => ({
      examCycleId: cycle.examCycle.id,
      generatedAt: now,
      priorities: [{
        ...tracks[0],
        subject: 'aptitude',
        module: '判断推理',
        name: '论证结构',
        priority: 82,
        action: 'practice',
        reasonCodes: ['low_accuracy'],
        scoreGapRatio: .3,
        evidenceAgeDays: 2
      }]
    })
  };
  const plans = { findCurrent: async () => plan };
  const sessions = { listRecent: async (_cycle, limit) => [facts].slice(0, limit) };
  const content = {
    findQuestionSet: async () => contentBundle,
    queryQuestionSetLibrary: async () => [{
      id: 'QuestionSetId:true', capabilityNodeId: 'CapabilityNodeId:1', questionCount: 8, originType: 'official'
    }]
  };
  const threads = { findOpen: async () => ({ thread: learningThread(), events: [] }) };

  const contextBuilder = new tutoring.BuildTutorDailyContext(
    candidates, curriculums, mastery, learnerPriorities, plans, sessions, content, threads, repository,
    { async execute() { return undefined; } }, clock
  );
  const context = await contextBuilder.execute();
  assert(context);
  assert.equal(context.priorityCapabilities.length, 1);
  assert.equal(context.priorityCapabilities[0].recommendedAction, 'practice');
  assert.equal(context.dueReviews.length, 1);
  assert.equal(context.trueQuestionEvidence.recentSessionCount, 1);
  assert.equal(context.trueQuestionEvidence.availableQuestionCount, 8);
  assert.equal(context.activeThreads.length, 1);
  assert.equal(context.confirmation.requiredWhen.includes('cross_module_action'), true);

  let id = 0;
  const ids = { next: (namespace) => `${namespace}:${++id}` };
  const unitOfWork = { run: (work) => work({}), runAutocommit: (work) => work({}) };
  const objectiveReview = {
    session: facts.session,
    items: [{
      question: { id: 'QuestionId:1', sequence: 1 },
      attempt: facts.attempts[0],
      grading: facts.gradings[0],
      diagnoses: [{ causeCode: 'unknown' }],
      diagnosisProjections: []
    }]
  };
  const recorder = new tutoring.RecordObjectiveTutorConclusion(
    unitOfWork,
    repository,
    { execute: async () => objectiveReview },
    candidates,
    curriculums,
    mastery,
    plans,
    clock,
    ids
  );
  const first = await recorder.execute({
    idempotencyKey: 'submit:1:tutor-conclusion:v1',
    sessionId: facts.session.id,
    diagnosisRunIds: ['AgentRunId:diagnosis'],
    pendingSteps: []
  });
  const repeated = await recorder.execute({
    idempotencyKey: 'submit:1:tutor-conclusion:v1',
    sessionId: facts.session.id,
    diagnosisRunIds: [],
    pendingSteps: []
  });
  assert.equal(first.id, repeated.id);
  assert.equal(conclusions.length, 1);
  assert.equal(first.diagnosis.status, 'pending');
  assert.equal(first.proposal.nextAction, 'repair');
  assert.equal(first.schedule.reviews.length, 1);
  assert.deepEqual(Object.keys(first).includes('observation'), true);
  assert.deepEqual(Object.keys(first).includes('assessment'), true);
  const finalizer = new tutoring.FinalizeObjectiveTutorConclusion(
    unitOfWork,
    repository,
    {
      findMany: async () => [{
        id: 'ErrorDiagnosisId:ai:1',
        sessionId: facts.session.id,
        source: 'tutor_ai',
        causeCode: 'method_selection_error'
      }]
    },
    clock,
    ids
  );
  const finalized = await finalizer.execute({
    agentRunId: 'AgentRunId:diagnosis',
    sessionId: facts.session.id,
    diagnosisIds: ['ErrorDiagnosisId:ai:1']
  });
  const finalizedAgain = await finalizer.execute({
    agentRunId: 'AgentRunId:diagnosis',
    sessionId: facts.session.id,
    diagnosisIds: ['ErrorDiagnosisId:ai:1']
  });
  assert.equal(finalized.id, finalizedAgain.id);
  assert.equal(finalized.diagnosis.status, 'available');
  assert.deepEqual(finalized.diagnosis.pendingDiagnosisRunIds, []);
  assert.deepEqual(finalized.diagnosis.knownCauseCodes, ['method_selection_error']);
  assert.equal(conclusions.length, 2, 'AI diagnosis completion appends one immutable conclusion revision');
  const refreshedContext = await contextBuilder.execute();
  assert.equal(refreshedContext.recentTeachingConclusions.length, 1);
  assert.equal(refreshedContext.recentTeachingConclusions[0].diagnosis.status, 'available');
  console.log('Proactive tutor-loop verification passed.');
} finally {
  await server.close();
}

function candidateCycle() {
  return {
    project: { id: 'ProjectId:1', name: '江苏省考' },
    profile: {},
    examCycle: {
      id: 'ExamCycleId:1', examType: 'provincial', examName: '江苏省考', examDate: '2027-12-01',
      phase: 'foundation', timeZone: 'Asia/Shanghai', curriculumVersionId: 'CurriculumVersionId:1'
    },
    scoreTargets: [{ subject: 'aptitude', targetScore: 80, maxScore: 100, status: 'active' }],
    scoreMeasurements: [],
    studyConstraints: { weekdayMinutes: 60, weekendMinutes: 120 },
    learningPreferences: {},
    policyBindings: []
  };
}

function planItem(itemType) {
  return {
    id: 'DailyPlanItemId:navigation',
    dailyPlanId: 'DailyPlanId:navigation',
    capabilityNodeId: 'CapabilityNodeId:1',
    itemType,
    sequence: 1,
    targetMinutes: 10,
    exitCriteria: {},
    reason: 'test',
    status: 'pending',
    actualMinutes: 0
  };
}

function curriculumBundle() {
  return {
    capabilityNodes: [{
      id: 'CapabilityNodeId:1', code: 'aptitude.judgment.argument', name: '论证结构', module: 'judgment',
      subject: 'aptitude', status: 'active'
    }]
  };
}

function masteryTrack() {
  return {
    id: 'MasteryTrackId:1', examCycleId: 'ExamCycleId:1', capabilityNodeId: 'CapabilityNodeId:1',
    state: 'regressed', concept: .5, recognition: .5, method: .45, accuracy: .4, speed: .5,
    retention: .3, transfer: .2, stability: .25, confidence: .6, effectiveSample: 5,
    lastStateChangeAt: 1, algorithmVersion: 'v1', version: 1, createdAt: 1, updatedAt: 1
  };
}

function reviewItem() {
  return {
    id: 'ReviewQueueItemId:1', examCycleId: 'ExamCycleId:1', capabilityNodeId: 'CapabilityNodeId:1',
    masteryTrackId: 'MasteryTrackId:1', reviewType: 'repair', dueAt: 1, priority: .9, intervalDays: 0,
    stabilityBefore: .25, status: 'scheduled', reason: 'recent_performance_regression', version: 1, updatedAt: 1
  };
}

function dailyPlan() {
  return {
    plan: { id: 'DailyPlanId:1', examCycleId: 'ExamCycleId:1', planDate: '2026-07-27', status: 'active', decisionSummary: '先修复论证结构。' },
    items: [{
      id: 'DailyPlanItemId:1', capabilityNodeId: 'CapabilityNodeId:1', itemType: 'review', targetMinutes: 15,
      targetCount: 4, reason: 'recent_performance_regression', status: 'pending'
    }]
  };
}

function learningThread() {
  return {
    id: 'LearningThreadId:1', examCycleId: 'ExamCycleId:1', primaryCapabilityNodeId: 'CapabilityNodeId:1',
    stage: 'practice', goal: '掌握论证结构', nextAction: { type: 'repair' }
  };
}

function objectiveFacts() {
  return {
    session: {
      id: 'LearningSessionId:1', examCycleId: 'ExamCycleId:1', learningThreadId: 'LearningThreadId:1',
      questionSetId: 'QuestionSetId:1', assessmentRole: 'anchor', completedAt: 100, elapsedMs: 60_000,
      questionCount: 1, answeredCount: 1, correctCount: 0
    },
    attempts: [{ id: 'AttemptId:1', capabilityNodeId: 'CapabilityNodeId:1' }],
    gradings: [{ result: 'incorrect' }]
  };
}
