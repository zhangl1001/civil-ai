import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const server = await createServer({ root, configFile: false, resolve: { alias: { '@': path.join(root, 'src') } }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const now = 1_800_000_000_000;
const evidence = (id, value, role = 'practice', type = 'correctness') => ({
  id, examCycleId: 'cycle:1', capabilityNodeId: 'node:1', assessmentRole: role, evidenceType: type,
  value, weight: 1, quality: 1, source: 'deterministic_grader', validationPolicyVersion: 'test:v1',
  occurredAt: now, idempotencyKey: id, metadata: {}
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
      ...Array.from({ length: 24 }, (_, index) => evidence(`anchor:${index}`, 1, 'anchor')),
      evidence('retention:1', 1, 'retention', 'retention'),
      evidence('transfer:1', 1, 'transfer', 'transfer'),
      evidence('method:1', 1, 'practice', 'method_recognition'),
      evidence('concept:1', 1, 'teaching', 'teaching_comprehension')
    ]
  });
  assert.equal(proven.state, 'mastered');

  const regressed = mastery.projectMastery({
    now,
    evidence: Array.from({ length: 8 }, (_, index) => evidence(`error:${index}`, 0))
  });
  assert.equal(regressed.state, 'regressed');
  const plan = mastery.proposeDailyPlan({
    examCycleId: 'cycle:1', availableMinutes: 35,
    dueReviews: [{ id: 'review:1', examCycleId: 'cycle:1', capabilityNodeId: 'node:review', masteryTrackId: 'track:1', reviewType: 'retention', dueAt: now, priority: 1, intervalDays: 1, stabilityBefore: 0.3, status: 'scheduled', reason: 'spaced_retention_maintenance', updatedAt: now }],
    priorityTracks: [{ id: 'track:2', examCycleId: 'cycle:1', capabilityNodeId: 'node:weak', state: 'regressed', concept: 0, recognition: 0, method: 0, accuracy: 0.2, speed: 0, retention: 0, transfer: 0, stability: 0.1, confidence: 0.6, effectiveSample: 8, lastStateChangeAt: now, algorithmVersion: 'test:v1', version: 1, createdAt: now, updatedAt: now }]
  });
  assert.equal(plan.items[0].action, 'review');
  assert.ok(plan.plannedMinutes <= 35);

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

  const planning = await server.ssrLoadModule('/src/modules/planning/public.ts');
  const planItems = new Map([['review:state', {
    id: 'plan-item:1', dailyPlanId: 'plan:1', capabilityNodeId: 'node:review', reviewQueueItemId: 'review:state',
    itemType: 'review', sequence: 1, targetMinutes: 12, targetCount: 4, exitCriteria: {}, reason: 'review_due',
    status: 'pending', actualMinutes: 0
  }]]);
  const planRepository = {
    async updateItemByReviewQueueId(id, patch) {
      const item = planItems.get(id);
      if (!item) return undefined;
      const updated = { ...item, status: patch.status, actualMinutes: patch.actualMinutes ?? item.actualMinutes };
      planItems.set(id, updated);
      return updated;
    }
  };
  const updatePlanItem = new planning.UpdateDailyPlanItemStatus(unitOfWork, planRepository);
  assert.equal((await updatePlanItem.execute({ reviewQueueItemId: 'review:state', status: 'in_progress' })).status, 'in_progress');
  const finishedPlanItem = await updatePlanItem.execute({ reviewQueueItemId: 'review:state', status: 'completed', actualMinutes: 8 });
  assert.equal(finishedPlanItem.status, 'completed');
  assert.equal(finishedPlanItem.actualMinutes, 8);
  console.log('Mastery policy verification passed.');
} finally { await server.close(); }
