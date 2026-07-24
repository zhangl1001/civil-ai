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

try {
  const candidate = await server.ssrLoadModule('/src/modules/candidate/public.ts');
  const curriculum = await server.ssrLoadModule('/src/modules/curriculum/public.ts');
  const bundles = new Map();
  const drafts = new Map();
  const receipts = new Map();
  const outbox = [];
  let currentBundle;
  let idSequence = 0;

  const unitOfWork = {
    run: async (work) => work({})
  };
  const candidateRepository = {
    createCycleBundle: async (bundle) => {
      assert.equal(currentBundle, undefined, 'test repository only permits one active bundle');
      currentBundle = bundle;
      bundles.set(bundle.examCycle.id, bundle);
    },
    replaceActiveScoreTargets: async (targets) => {
      const replacedIds = new Set(targets.map((target) => target.supersedesTargetId));
      currentBundle = {
        ...currentBundle,
        scoreTargets: [
          ...currentBundle.scoreTargets.map((target) => replacedIds.has(target.id)
            ? { ...target, status: candidate.ScoreTargetStatus.Superseded }
            : target),
          ...targets
        ]
      };
      bundles.set(currentBundle.examCycle.id, currentBundle);
    },
    findCurrentCycle: async () => currentBundle,
    findCycle: async (examCycleId) => bundles.get(examCycleId),
    findActiveCycle: async (projectId) => currentBundle?.project.id === projectId ? currentBundle : undefined,
    saveOnboardingDraft: async (draft) => drafts.set(draft.id, draft),
    findOnboardingDraft: async (draftId) => drafts.get(draftId),
    deleteOnboardingDraft: async (draftId) => drafts.delete(draftId)
  };
  const curriculumBundle = curriculum.createBundledNationalCurriculum();
  const curriculumRepository = {
    installBundle: async () => undefined,
    findBundle: async (curriculumVersionId) => (
      curriculumVersionId === curriculumBundle.curriculum.id ? curriculumBundle : undefined
    )
  };
  const outboxRepository = {
    append: async (event) => outbox.push(event),
    claimPending: async () => [],
    markPublished: async () => false,
    recordFailure: async () => false
  };
  const receiptRepository = {
    find: async (key) => receipts.get(key),
    append: async (receipt) => receipts.set(receipt.idempotencyKey, receipt)
  };
  const clock = {
    now: () => 1_800_000_000_000,
    monotonicNowMs: () => 100
  };
  const ids = {
    next: (namespace) => `${namespace}:test-${++idSequence}`
  };
  const useCase = new candidate.CreateCandidateCycle(
    unitOfWork,
    candidateRepository,
    curriculumRepository,
    outboxRepository,
    receiptRepository,
    clock,
    ids,
    candidate.candidateOnboardingPolicy
  );
  const command = {
    idempotencyKey: 'onboarding:test-1',
    projectName: '2027 国考周期',
    preferredName: '测试考生',
    timeZone: 'Asia/Shanghai',
    examType: 'civil_service',
    examName: '2027 国考',
    examDate: '2027-11-30',
    phase: candidate.ExamPhase.Foundation,
    curriculumVersionId: curriculumBundle.curriculum.id,
    subjectScores: [
      { subject: 'aptitude', currentScore: 50, targetScore: 80, maxScore: 100 },
      { subject: 'essay', currentScore: 50, targetScore: 70, maxScore: 100 }
    ],
    study: {
      mode: candidate.StudyMode.PartTime,
      weeklyStudyDays: 6,
      weekdayMinutes: 120,
      weekendMinutes: 240,
      maxFocusMinutes: 50,
      availableWindows: [],
      interruptionRisks: []
    },
    preferences: {
      teachingOrder: candidate.TeachingOrder.DiagnoseThenExplain,
      explanationDepth: candidate.ExplanationDepth.Balanced,
      proactiveLevel: candidate.ProactiveLevel.Balanced,
      companionTone: candidate.CompanionTone.Gentle,
      quietHours: [],
      accessibility: {}
    }
  };

  assert.equal(await candidateRepository.findCurrentCycle(), undefined);
  const homeQuery = new candidate.GetCandidateHome(candidateRepository);
  assert.equal(await homeQuery.execute(), undefined);
  const first = await useCase.execute(command);
  const repeated = await useCase.execute(command);
  assert.equal(first.examCycle.id, repeated.examCycle.id);
  assert.equal(bundles.size, 1);
  assert.equal(receipts.size, 1);
  assert.equal(outbox.length, 1);
  assert.equal(first.scoreTargets.length, 2);
  assert.equal(first.scoreMeasurements.length, 2);
  assert(first.policyBindings.some((binding) => binding.subject === 'aptitude' && binding.policyType === 'mastery'));
  assert(first.policyBindings.some((binding) => binding.subject === 'essay' && binding.policyType === 'mastery'));
  assert(first.policyBindings.some((binding) => binding.subject === 'essay' && binding.policyType === 'grading_rubric'));
  const home = await homeQuery.execute();
  assert.equal(home.projectName, command.projectName);
  assert.equal(home.diagnosisStatus, candidate.InitialDiagnosisStatus.DataInsufficient);
  assert.deepEqual(
    home.scores.map((score) => [score.subject, score.currentScore, score.targetScore, score.gap, score.evidenceLabel]),
    [
      ['aptitude', 50, 80, 30, 'self_report'],
      ['essay', 50, 70, 20, 'self_report']
    ]
  );

  const updateTargets = new candidate.UpdateScoreTargets(
    unitOfWork,
    candidateRepository,
    outboxRepository,
    receiptRepository,
    clock,
    ids
  );
  const updated = await updateTargets.execute({
    idempotencyKey: 'targets:test-1',
    examCycleId: first.examCycle.id,
    changes: [{ subject: 'aptitude', targetScore: 82, maxScore: 100, reason: '阶段目标调整' }]
  });
  const updatedAgain = await updateTargets.execute({
    idempotencyKey: 'targets:test-1',
    examCycleId: first.examCycle.id,
    changes: [{ subject: 'aptitude', targetScore: 82, maxScore: 100, reason: '阶段目标调整' }]
  });
  assert.equal(updatedAgain.scoreTargets.length, updated.scoreTargets.length);
  assert.equal(updated.scoreTargets.filter((target) => target.subject === 'aptitude').length, 2);
  assert.equal(updated.scoreTargets.find((target) => target.subject === 'aptitude' && target.status === 'active')?.targetScore, 82);
  assert.equal(updated.scoreTargets.find((target) => target.subject === 'aptitude' && target.status === 'superseded')?.targetScore, 80);
  assert.equal(outbox.length, 2);

  const invalidUseCase = new candidate.CreateCandidateCycle(
    unitOfWork,
    { ...candidateRepository, findCurrentCycle: async () => undefined },
    curriculumRepository,
    outboxRepository,
    { ...receiptRepository, find: async () => undefined },
    clock,
    ids,
    candidate.candidateOnboardingPolicy
  );
  await assert.rejects(
    () => invalidUseCase.execute({
      ...command,
      idempotencyKey: 'onboarding:invalid',
      subjectScores: [{ subject: 'aptitude', currentScore: 120, targetScore: 80, maxScore: 100 }]
    }),
    (error) => error?.code === 'candidate.current_score_invalid'
  );

  console.log('Candidate onboarding verification passed.');
} finally {
  await server.close();
}
