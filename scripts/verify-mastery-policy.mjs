import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const server = await createServer({ root, configFile: false, resolve: { alias: { '@': path.join(root, 'src') } }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const now = 1_800_000_000_000;
const evidence = (id, value, role = 'practice', type = 'correctness', origin = 'ai_generated') => ({
  id, examCycleId: 'cycle:1', capabilityNodeId: 'node:1', assessmentRole: role, evidenceType: type,
  value, weight: 1, quality: 1, source: 'deterministic_grader', validationPolicyVersion: 'test:v1',
  occurredAt: now, idempotencyKey: id, metadata: { questionOriginType: origin }
});

try {
  const mastery = await server.ssrLoadModule('/src/modules/mastery/public.ts');
  const ordinaryPractice = mastery.projectMastery({
    now,
    evidence: Array.from({ length: 30 }, (_, index) => evidence(`practice:${index}`, 1))
  });
  assert.notEqual(ordinaryPractice.state, 'mastered');
  assert.equal(ordinaryPractice.retention, 0);
  assert.equal(ordinaryPractice.transfer, 0);

  const proven = mastery.projectMastery({
    now,
    evidence: [
      ...Array.from({ length: 24 }, (_, index) => evidence(`anchor:${index}`, 1, 'anchor', 'correctness', 'official')),
      evidence('retention:1', 1, 'retention', 'retention', 'official'),
      evidence('transfer:1', 1, 'transfer', 'transfer', 'official'),
      evidence('method:1', 1, 'practice', 'method_recognition'),
      evidence('concept:1', 1, 'teaching', 'teaching_comprehension')
    ]
  });
  assert.equal(proven.state, 'mastered');

  const aiOnlyProven = mastery.projectMastery({
    now,
    evidence: [
      ...Array.from({ length: 24 }, (_, index) => evidence(`ai-anchor:${index}`, 1, 'anchor')),
      evidence('ai-retention:1', 1, 'retention', 'retention'),
      evidence('ai-transfer:1', 1, 'transfer', 'transfer')
    ]
  });
  assert.equal(aiOnlyProven.state, 'mastered', 'diverse AI assessments must be able to prove mastery without a hard source ceiling');

  const partialStructuredEvidence = mastery.projectMastery({
    now,
    evidence: [
      ...Array.from({ length: 8 }, (_, index) => evidence(`partial:${index}`, 0.8)),
      evidence('concept-only', 0.8, 'teaching', 'teaching_comprehension')
    ]
  });
  assert.notEqual(partialStructuredEvidence.state, 'learning', 'missing structured dimensions must remain unknown instead of becoming zero scores');

  const splitDecisionDimensions = mastery.projectMastery({
    now,
    evidence: [
      ...Array.from({ length: 8 }, (_, index) => evidence(`split:${index}`, 0.8)),
      { ...evidence('recognition-gap', 0.2, 'practice', 'method_recognition'), metadata: { questionOriginType: 'ai_generated', masteryDimension: 'recognition' } },
      { ...evidence('method-adequate', 0.9, 'practice', 'method_recognition'), metadata: { questionOriginType: 'ai_generated', masteryDimension: 'method' } }
    ]
  });
  assert.equal(splitDecisionDimensions.recognition, 0.2);
  assert.equal(splitDecisionDimensions.method, 0.9);
  assert.equal(splitDecisionDimensions.state, 'learning');

  assert.equal(mastery.reviewIntervalDays({
    state: 'practicing', accuracy: 0.8, retention: 0, transfer: 0, stability: 0.2, confidence: 0.6, effectiveSample: 12
  }) <= 7, true);
  assert.equal(mastery.reviewIntervalDays({
    state: 'consolidating', accuracy: 0.88, retention: 0.85, transfer: 0.8, stability: 0.75, confidence: 0.82, effectiveSample: 24
  }) > 30, true, 'strong memory evidence must unlock long spaced-review intervals before a terminal state');

  const regressed = mastery.projectMastery({
    now,
    evidence: Array.from({ length: 8 }, (_, index) => evidence(`error:${index}`, 0))
  });
  assert.equal(regressed.state, 'regressed');

  const prioritySignal = (id, overrides = {}) => ({
    capabilityNodeId: id, subject: 'aptitude', module: 'judgment', name: id,
    scoreWeight: 0.1, scoreGapRatio: 0.2, state: 'practicing', accuracy: 0.75,
    speed: 0.7, retention: 0.7, transfer: 0.65, stability: 0.7, confidence: 0.8,
    effectiveSample: 10, lastEvidenceAt: now - 2 * 86_400_000, ...overrides
  });
  const rankedPriorities = mastery.rankLearnerPriorities([
    prioritySignal('node:strong', { accuracy: 0.9, stability: 0.85 }),
    prioritySignal('node:weak', { accuracy: 0.4, stability: 0.45 })
  ], now);
  assert.equal(rankedPriorities[0].capabilityNodeId, 'node:weak', 'accuracy gaps must affect the shared learner ranking');
  const sampleAwarePriorities = mastery.rankLearnerPriorities([
    prioritySignal('node:single-error', {
      accuracy: 0, stability: 0, retention: 0, transfer: 0, confidence: 0.8, effectiveSample: 1
    }),
    prioritySignal('node:confirmed-gap', {
      accuracy: 0.45, stability: 0.5, retention: 0.5, transfer: 0.5, confidence: 0.8, effectiveSample: 30
    })
  ], now);
  assert.equal(sampleAwarePriorities[0].capabilityNodeId, 'node:confirmed-gap', 'one failed sample must not outrank a reliable ability gap');
  const learnedPriority = mastery.evaluateLearnerPriority(prioritySignal('node:learned', {
    learningStatus: 'completed', learningCompletedAt: now, lastEvidenceAt: now - 86_400_000
  }), now);
  assert.equal(learnedPriority.action, 'practice', 'completed learning must request validation instead of repeating the lecture');
  assert.ok(learnedPriority.reasonCodes.includes('learning_needs_validation'));
  const agedPriority = mastery.evaluateLearnerPriority(prioritySignal('node:aged', {
    retention: 0.8, lastEvidenceAt: now - 50 * 86_400_000
  }), now);
  assert.equal(agedPriority.action, 'review', 'aging evidence must trigger review');
  const pausedPriorities = mastery.rankLearnerPriorities([
    prioritySignal('node:paused', { preference: { mode: 'paused', pausedUntil: now + 86_400_000 } }),
    prioritySignal('node:active')
  ], now);
  assert.deepEqual(pausedPriorities.map((item) => item.capabilityNodeId), ['node:active']);

  const planning = await server.ssrLoadModule('/src/modules/planning/public.ts');
  const strategy = planning.decidePreparationStrategy({
    remainingDays: 120,
    averageScoreGapRatio: 0.3,
    curriculumCoverageRatio: 0.2,
    dueReviewCount: 1
  });
  const plan = planning.proposeDailyPlan({
    examCycleId: 'cycle:1', availableMinutes: 35,
    dueReviews: [{ id: 'review:1', examCycleId: 'cycle:1', capabilityNodeId: 'node:review', masteryTrackId: 'track:1', reviewType: 'retention', dueAt: now, priority: 1, intervalDays: 1, stabilityBefore: 0.3, status: 'scheduled', reason: 'spaced_retention_maintenance', updatedAt: now }],
    strategy,
    prioritySignals: [
      { capabilityNodeId: 'node:review', subject: 'aptitude', module: '判断推理', name: '复习节点', scoreWeight: 0.1, scoreGapRatio: 0.3, learnerPriority: 70, recommendedAction: 'review', state: 'maintaining', accuracy: 0.8, speed: 0.7, retention: 0.5, transfer: 0.5, stability: 0.5, confidence: 0.7, effectiveSample: 8 },
      { capabilityNodeId: 'node:weak', subject: 'aptitude', module: '判断推理', name: '薄弱节点', scoreWeight: 0.2, scoreGapRatio: 0.3, learnerPriority: 95, recommendedAction: 'learn', state: 'regressed', accuracy: 0.2, speed: 0, retention: 0, transfer: 0, stability: 0.1, confidence: 0.6, effectiveSample: 8 }
    ],
    coverageCandidates: [],
    currentAffairsCapability: {
      capabilityNodeId: 'node:current-affairs', subject: 'aptitude', module: 'common_sense',
      name: '政治与经济常识', scoreWeight: 0.025, scoreGapRatio: 0.3
    }
  });
  assert.equal(plan.items[0].action, 'review');
  assert.ok(plan.plannedMinutes <= 35);
  const digestItem = plan.items.find((item) => item.action === 'digest');
  assert.ok(digestItem);
  assert.equal(digestItem.category, 'accumulate');
  assert.equal(digestItem.completionCriteria.digestTab, 'news');
  assert.equal(digestItem.targetCount, plan.learningLoad.digest.targetThemes);
  const sprintStrategy = planning.decidePreparationStrategy({
    remainingDays: 30,
    averageScoreGapRatio: 0.3,
    curriculumCoverageRatio: 0.2,
    dueReviewCount: 1
  });
  const extendedStrategy = planning.decidePreparationStrategy({
    remainingDays: 300,
    averageScoreGapRatio: 0.3,
    curriculumCoverageRatio: 0.2,
    dueReviewCount: 1
  });
  assert.equal(sprintStrategy.horizon, 'sprint');
  assert.equal(extendedStrategy.horizon, 'extended');
  assert.ok(extendedStrategy.maximumNewCapabilities > sprintStrategy.maximumNewCapabilities);
  assert.ok(sprintStrategy.timedPracticeRatio > extendedStrategy.timedPracticeRatio);

  const unitOfWork = { async run(work) { return work({}); } };
  const reviewStore = new Map();
  const review = {
    id: 'review:state', examCycleId: 'cycle:1', capabilityNodeId: 'node:review', masteryTrackId: 'track:1',
    reviewType: 'retention', dueAt: now, priority: 1, intervalDays: 1, stabilityBefore: 0.3,
    status: 'scheduled', reason: 'spaced_retention_maintenance', version: 1, updatedAt: now
  };
  reviewStore.set(review.id, review);
  const reviewRepository = {
    async findReview(id) { return reviewStore.get(id); },
    async replaceReview(item, expectedVersion) {
      assert.equal(reviewStore.get(item.id).version, expectedVersion);
      assert.equal(item.version, expectedVersion + 1);
      reviewStore.set(item.id, item);
    }
  };
  const clock = { value: now, now() { return ++this.value; } };
  const startReview = new mastery.StartReviewQueueItem(unitOfWork, reviewRepository, clock);
  const failReview = new mastery.FailReviewQueueItem(unitOfWork, reviewRepository, clock);
  const retryReview = new mastery.RetryReviewQueueItem(unitOfWork, reviewRepository, clock);
  const completeReview = new mastery.CompleteReviewQueueItem(unitOfWork, reviewRepository, clock);
  const started = await startReview.execute('review:state');
  assert.equal(started.status, 'in_progress');
  assert.ok(started.claimedAt);
  const failed = await failReview.execute({ reviewQueueItemId: 'review:state', failureCode: 'Provider Timeout' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failureCode, 'provider_timeout');
  const retried = await retryReview.execute('review:state');
  assert.equal(retried.status, 'scheduled');
  assert.equal(retried.failureCode, undefined);
  const restarted = await startReview.execute('review:state');
  assert.equal(restarted.status, 'in_progress');
  const completed = await completeReview.execute('review:state');
  assert.equal(completed.status, 'completed');
  assert.ok(completed.completedAt);

  const planItems = new Map([['review:state', {
    id: 'plan-item:1', dailyPlanId: 'plan:1', capabilityNodeId: 'node:review', reviewQueueItemId: 'review:state',
    itemType: 'review', sequence: 1, targetMinutes: 12, targetCount: 4, exitCriteria: {}, reason: 'review_due',
    status: 'pending', actualMinutes: 0
  }]]);
  const planRepository = {
    async updateItemByReviewQueueId(id, patch) {
      const item = planItems.get(id);
      if (!item) return undefined;
      const updated = {
        ...item,
        status: patch.status,
        actualMinutes: patch.actualMinutes ?? item.actualMinutes,
        resultSummary: patch.resultSummary ?? item.resultSummary,
        failureCode: patch.failureCode,
        failureMessage: patch.failureMessage,
        finishedAt: patch.finishedAt
      };
      planItems.set(id, updated);
      return updated;
    }
  };
  const updatePlanItem = new planning.UpdateDailyPlanItemStatus(unitOfWork, planRepository, clock);
  assert.equal((await updatePlanItem.execute({ reviewQueueItemId: 'review:state', status: 'in_progress' })).status, 'in_progress');
  const failedPlanItem = await updatePlanItem.execute({
    reviewQueueItemId: 'review:state',
    status: 'pending',
    failureCode: 'provider_timeout',
    failureMessage: '模型响应超时'
  });
  assert.equal(failedPlanItem.failureCode, 'provider_timeout');
  const finishedPlanItem = await updatePlanItem.execute({
    reviewQueueItemId: 'review:state',
    status: 'completed',
    actualMinutes: 8,
    resultSummary: { correct: 3, total: 4 }
  });
  assert.equal(finishedPlanItem.status, 'completed');
  assert.equal(finishedPlanItem.actualMinutes, 8);
  assert.ok(finishedPlanItem.finishedAt);

  let currentPlan = {
    plan: {
      id: 'daily:1', examCycleId: 'cycle:1', planDate: '2027-01-15', version: 1, status: 'active',
      phase: 'foundation', availableMinutes: 35, decisionSummary: 'initial', decisionFactors: {},
      createdBy: 'system', createdAt: now
    },
    blocks: [{
      id: 'block:1', dailyPlanId: 'daily:1', capabilityNodeId: 'node:review', subject: 'aptitude',
      module: '判断推理', teachingGoalCode: 'retention_maintenance', sequence: 1, priority: 80, required: true
    }],
    items: [
      { ...finishedPlanItem, id: 'done:1', dailyPlanId: 'daily:1', dailyPlanBlockId: 'block:1', category: 'review', priority: 80, required: true, dependencyIds: [], reviewQueueItemId: undefined },
      { ...finishedPlanItem, id: 'pending:1', dailyPlanId: 'daily:1', dailyPlanBlockId: 'block:1', category: 'review', priority: 80, required: true, dependencyIds: [], status: 'pending', actualMinutes: 0, finishedAt: undefined }
    ]
  };
  const replanRepository = {
    async findCurrent() { return currentPlan; },
    async replaceCurrent(next, previous) {
      assert.equal(previous.id, currentPlan.plan.id);
      currentPlan = next;
    }
  };
  let generatedId = 0;
  const ids = { next(type) { generatedId += 1; return `${type}:${generatedId}`; } };
  const persistPlan = new planning.PersistDailyPlanProposal(unitOfWork, replanRepository, clock, ids);
  const rebalance = new planning.RebalanceDailyPlanAfterLearning(
    {
      async findCycle() {
        return {
          examCycle: { id: 'cycle:1', phase: 'foundation', timeZone: 'Asia/Shanghai' },
          studyConstraints: { weekdayMinutes: 35, weekendMinutes: 35 }
        };
      }
    },
    replanRepository,
    {
      async execute({ examCycleId, availableMinutes }) {
        return {
          examCycleId,
          availableMinutes,
          plannedMinutes: 24,
          blocks: [
            { key: 'block:duplicate', capabilityNodeId: 'node:review', subject: 'aptitude', module: '判断推理', teachingGoalCode: 'retention_maintenance', sequence: 1, priority: 90, required: true },
            { key: 'block:next', capabilityNodeId: 'node:next', subject: 'aptitude', module: '判断推理', teachingGoalCode: 'retention_maintenance', sequence: 2, priority: 80, required: true }
          ],
          items: [
            { key: 'item:duplicate', blockKey: 'block:duplicate', capabilityNodeId: 'node:review', category: 'review', action: 'review', targetMinutes: 12, targetCount: 4, priority: 90, required: true, dependencyKeys: [], completionCriteria: { event: 'practice_submitted', targetCount: 4 }, reasonCode: 'duplicate_action' },
            { key: 'item:next', blockKey: 'block:next', capabilityNodeId: 'node:next', category: 'review', action: 'review', targetMinutes: 12, targetCount: 4, priority: 80, required: true, dependencyKeys: [], completionCriteria: { event: 'practice_submitted', targetCount: 4 }, reasonCode: 'latest_evidence' }
          ],
          rationaleCodes: ['reviews_first'],
          strategy,
          learningLoad: plan.learningLoad
        };
      }
    },
    persistPlan,
    { now() { return Date.parse('2027-01-15T08:00:00+08:00'); } }
  );
  const rebalanced = await rebalance.execute({
    examCycleId: 'cycle:1',
    reason: planning.DailyPlanRebalanceReason.LearningResult,
    sourceId: 'session:1'
  });
  assert.equal(rebalanced.plan.version, 2);
  assert.equal(rebalanced.items[0].status, 'completed');
  assert.equal(rebalanced.items[1].capabilityNodeId, 'node:next');
  assert.equal(rebalanced.items.length, 2);
  assert.equal(rebalanced.plan.decisionFactors.rebalanceReason, 'learning_result');

  let completionRebalanced = false;
  const completeDailyPlanItem = new planning.CompleteDailyPlanItem(
    { async findCurrentCycle() { return { examCycle: { id: 'cycle:1' } }; } },
    {
      async execute(command) {
        assert.equal(command.status, 'completed');
        return { ...finishedPlanItem, id: command.dailyPlanItemId, status: command.status };
      }
    },
    {
      async execute(command) {
        assert.equal(command.reason, 'learning_result');
        completionRebalanced = true;
      }
    }
  );
  const completedLecture = await completeDailyPlanItem.execute({
    dailyPlanItemId: 'lecture:1',
    resultSummary: { assetId: 'asset:1' }
  });
  assert.equal(completedLecture.status, 'completed');
  assert.equal(completionRebalanced, true);

  const proactive = await server.ssrLoadModule('/src/modules/proactive/public.ts');
  const preferences = {
    id: 'preferences:1', examCycleId: 'cycle:1', teachingOrder: 'explain_first', explanationDepth: 'balanced',
    proactiveLevel: 'balanced', companionTone: 'supportive', quietHours: [], accessibility: {}, extension: {},
    updatedAt: now, version: 1
  };
  const allowed = await proactive.decideProactiveDelivery({
    preferences, signalType: proactive.ProactiveSignalType.ReviewDue, priority: 85, now,
    repository: { async findLatestByType() { return undefined; } }
  });
  assert.equal(allowed.allowed, true);
  const cooledDown = await proactive.decideProactiveDelivery({
    preferences, signalType: proactive.ProactiveSignalType.ReviewDue, priority: 85, now,
    repository: { async findLatestByType() { return { createdAt: now - 60 * 60 * 1000 }; } }
  });
  assert.equal(cooledDown.allowed, false);
  const quiet = await proactive.decideProactiveDelivery({
    preferences: { ...preferences, proactiveLevel: 'quiet' },
    signalType: proactive.ProactiveSignalType.DailyCheckin,
    priority: 45,
    now,
    repository: { async findLatestByType() { return undefined; } }
  });
  assert.equal(quiet.reason, 'quiet_level');
  console.log('Mastery policy verification passed.');
} finally { await server.close(); }
