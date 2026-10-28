// Adapted from ui-second-pass/probe-route-reuse.mjs; the original audit evidence stays unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import os from 'node:os';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import vuePlugin from '../web/node_modules/@vitejs/plugin-vue/dist/index.mjs';
const root = new URL('../web', import.meta.url).pathname;
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'practice-ui-'));
const require = createRequire(`${root}/package.json`);
const vue = require('vue');
const vr = await import(`${root}/node_modules/vue-router/dist/vue-router.mjs`);
globalThis.__auditRuntime = {};
globalThis.document = { compatMode: 'CSS1Compat', addEventListener() {}, removeEventListener() {} };
let intervalId = 0;
globalThis.window = { addEventListener() {}, removeEventListener() {}, setInterval: () => ++intervalId, clearInterval() {}, setTimeout, clearTimeout };
const server = await createServer({ root, configFile: false, cacheDir: `${dir}/vite-cache`,
  plugins: [{ name: 'audit-route-memory-runtime', enforce: 'pre', load(id) {
    if (id === `${root}/src/composition-root/public.ts`) return 'export const initializeTutorRuntime = async () => globalThis.__auditInitialize ? globalThis.__auditInitialize() : globalThis.__auditRuntime; export const agentWorkerCoordinator = { start() {} };';
    if (id === `${root}/src/stores/aiChat.ts`) return 'export const useAIChatStore = () => ({});';
    if (id === `${root}/src/composition-root/evidence/ObjectiveSubmissionRecoveryCoordinator.ts`) return 'export const objectiveSubmissionRecoveryCoordinator = { start() {} };';
  } }, vuePlugin()], resolve: { alias: { '@': `${root}/src` } }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom'
});
const renderer = vue.createRenderer({ insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} });
const turn = async () => { for (let i = 0; i < 15; i++) await new Promise(r => setImmediate(r)); };
let app;
try {
  const content = await server.ssrLoadModule('/src/modules/content/public.ts');
  const { SubmitObjectiveSession } = await server.ssrLoadModule('/src/modules/evidence/application/SubmitObjectiveSession.ts');
  const raw = JSON.parse(await fs.readFile(`${root}/src/modules/content/fixtures/single-choice-weakening-v2.json`, 'utf8'));
  const baseContent = new content.ContentSchemaValidator().parseChoiceQuestion(raw).value;
  const questionContent = name => ({ ...baseContent, prompt: { schemaVersion: 'content.v1', blocks: [{ id: 'stem', type: 'text', source: `${name} 独立题干` }] }, explanation: { schemaVersion: 'content.v1', blocks: [{ id: 'options', type: 'callout', kind: 'hint', blocks: [{ id: 'options-text', type: 'text', source: 'A. 解析 B. 解析 C. 解析 D. 解析' }] }] } });
  const makeSet = name => ({ questionSet: { id: `set-${name}`, examCycleId: 'cycle', capabilityNodeId: 'cap', learningThreadId: `thread-${name}`, status: 'ready', module: 'judgment', assessmentRole: 'practice', contentVersion: 1, questionCount: 1 }, generationSpec: { constraints: {} }, questions: [{ id: `q-${name}`, capabilityNodeId: 'cap', sequence: 1, contentVersion: 1, content: questionContent(name) }], capabilityLinks: [], documents: [{ documentType: content.ContentDocumentType.Lecture, content: { schemaVersion: 'content.v1', blocks: [{ id: 'lecture', type: 'text', source: '完整讲义' }] } }], lectures: [], lectureLinks: [] });
  const sets = { 'set-A': makeSet('A'), 'set-B': makeSet('B') };
  const draftWrites = []; const drafts = new Map(); const statusWrites = []; const retired = []; const commits = []; const outbox = [];
  const unitOfWork = { run: async fn => fn({}), runAutocommit: async fn => fn({}) };
  const contentRepository = { findQuestionSet: async id => sets[id], updateQuestionSetPracticeStatus: async (id, status) => statusWrites.push({ id, status }) };
  const sessions = { findByIdempotencyKey: async () => undefined, listByQuestionSet: async () => [], commitObjectiveSession: async bundle => commits.push(bundle) };
  const submitUseCase = new SubmitObjectiveSession(unitOfWork, contentRepository, { findById: async id => ({ thread: { id, examCycleId: 'cycle', primaryCapabilityNodeId: 'cap', status: 'active' } }) }, sessions, { append: async () => {}, listBySession: async () => [] }, { append: async () => {} }, { append: async entry => outbox.push(entry) }, { now: () => Date.now() }, { next: prefix => `${prefix}:${++intervalId}` });
  globalThis.__auditRuntime = {
    unitOfWork, contentRepository, learningSessionRepository: sessions,
    candidateRepository: { findCurrentCycle: async () => ({ examCycle: { id: 'cycle', curriculumVersionId: 'cv' } }) },
    curriculumRepository: { findBundle: async () => ({ capabilityNodes: [] }) },
    questionSourceRepository: {}, ensureQuestionSetEnrichment: { execute: async () => {} },
    learningAssetStore: { findLatest: async (_cycle, _kind, key) => drafts.get(key), saveDraft: async cmd => { draftWrites.push(cmd); drafts.set(cmd.businessKey, { status: 'draft', payload: cmd.payload }); }, retireBusinessKey: async (_cycle, _kind, key) => { retired.push(key); drafts.delete(key); } },
    submitObjectiveSession: submitUseCase,
    getObjectiveSessionReview: { execute: async id => ({ session: commits.find(c => c.session.id === id)?.session, items: [] }) }
  };
  const { default: Session } = await server.ssrLoadModule('/src/features/practice/TutorPracticeSessionView.vue');
  let instance;
  Session.render = function() { instance = vue.getCurrentInstance(); return null; };
  const router = vr.createRouter({ history: vr.createMemoryHistory(), routes: [{ path: '/vue/practice/objective-session', component: Session }] });
  await router.push({ path: '/vue/practice/objective-session', query: { questionSetId: 'set-A', learningThreadId: 'thread-A' } });
  app = renderer.createApp({ render: () => vue.h(vr.RouterView) }); app.use(router); app.provide(vue.ssrContextKey, {}); app.mount({}); await turn();
  const state = instance.setupState;
  const firstInstance = instance;
  const go = (name) => router.push({ path: '/vue/practice/objective-session', query: {
    questionSetId: `set-${name}`, learningThreadId: `thread-${name}`,
    dailyPlanItemId: `plan-item-${name}`, reviewQueueItemId: `review-${name}`
  } });
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
  assert.equal(state.bundle.questionSet.id, 'set-A');
  state.answers = { 'q-A': [baseContent.correctOptionId] };
  await go('B'); await turn();
  assert.equal(instance, firstInstance, 'the real router reuses the component');
  assert.equal(state.bundle.questionSet.id, 'set-B');
  assert.deepEqual(state.answers, {}, 'B cannot inherit A answers');
  assert.equal(draftWrites[0].businessKey, 'question-set:set-A');
  assert.equal(draftWrites[0].payload.currentQuestionId, 'q-A');
  state.answers = { 'q-B': [baseContent.correctOptionId] };
  await state.persistDraft();
  await state.submit(); await turn();
  assert.equal(commits.length, 1);
  assert.equal(commits[0].session.questionSetId, 'set-B');
  assert.equal(commits[0].session.learningThreadId, 'thread-B');
  assert.equal(commits[0].session.reviewQueueItemId, 'review-B');
  assert.equal(outbox[0].payload.dailyPlanItemId, 'plan-item-B');
  assert(retired.includes('question-set:set-B'));
  assert(!retired.includes('question-set:set-A'));
  assert.equal(draftWrites.at(-1).payload.currentQuestionId, 'q-B');

  // A late load must not replace B.
  let gate = deferred();
  const normalFind = contentRepository.findQuestionSet;
  contentRepository.findQuestionSet = async id => id === 'set-A' ? gate.promise : normalFind(id);
  await go('A'); await turn();
  assert.equal(state.bundle, undefined);
  await go('B'); await turn();
  gate.resolve(sets['set-A']); await turn();
  assert.equal(state.bundle.questionSet.id, 'set-B');
  contentRepository.findQuestionSet = normalFind;

  // A draft read that started before the route change cannot restore into B.
  gate = deferred();
  const assets = globalThis.__auditRuntime.learningAssetStore;
  const normalDraft = assets.findLatest;
  assets.findLatest = async (_cycle, _kind, key) => key === 'question-set:set-A' ? gate.promise : normalDraft(_cycle, _kind, key);
  await go('A'); await turn();
  await go('B'); await turn();
  gate.resolve({ status: 'draft', payload: { ...draftWrites[0].payload, answers: { 'q-A': ['A'] } } }); await turn();
  assert.equal(state.bundle.questionSet.id, 'set-B');
  assert.equal(state.answers['q-A'], undefined);
  assets.findLatest = normalDraft;

  // The real enrichment poll can resolve after cancellation without updating B.
  const originalA = sets['set-A'];
  sets['set-A'] = { ...originalA, documents: [] };
  gate = deferred();
  let reads = 0;
  contentRepository.findQuestionSet = async id => id === 'set-A' && ++reads > 1 ? gate.promise : normalFind(id);
  await go('A'); await turn();
  assert.equal(reads, 2, 'the second read is the active content poll');
  const oldSignal = state.sessionSignal;
  await go('B'); await turn();
  assert.equal(oldSignal.aborted, true);
  gate.resolve(originalA); await turn();
  assert.equal(state.bundle.questionSet.id, 'set-B');
  assert.equal(state.error, '');
  sets['set-A'] = originalA;
  contentRepository.findQuestionSet = normalFind;

  // Capture draft contents before runtime resolution; later saves use the old key.
  await go('A'); await turn();
  state.answers = { 'q-A': [baseContent.correctOptionId] };
  gate = deferred();
  globalThis.__auditInitialize = () => gate.promise;
  const savesStart = draftWrites.length;
  const pendingSave = state.persistDraft();
  await go('B'); await turn();
  gate.resolve(globalThis.__auditRuntime);
  await pendingSave; await turn();
  delete globalThis.__auditInitialize;
  assert.equal(state.bundle.questionSet.id, 'set-B');
  for (const write of draftWrites.slice(savesStart)) {
    assert.equal(write.businessKey, 'question-set:set-A');
    assert.deepEqual(Object.keys(write.payload.answers), ['q-A']);
  }

  // An accepted submission finishes as A while B waits for that commit.
  await go('A'); await turn();
  state.answers = { 'q-A': [baseContent.correctOptionId] };
  gate = deferred();
  const normalCommit = sessions.commitObjectiveSession;
  sessions.commitObjectiveSession = async value => { await gate.promise; return normalCommit(value); };
  const oldCommitCount = commits.length;
  const pendingSubmit = state.submit(); await turn();
  assert.equal(state.submitting, true);
  const retireStart = retired.length;
  await go('B'); await turn();
  assert.equal(state.bundle, undefined);
  gate.resolve(); await pendingSubmit; await turn();
  sessions.commitObjectiveSession = normalCommit;
  assert.equal(commits.length, oldCommitCount + 1);
  assert.equal(commits.at(-1).session.questionSetId, 'set-A');
  assert.equal(commits.at(-1).session.learningThreadId, 'thread-A');
  assert.equal(commits.at(-1).session.reviewQueueItemId, 'review-A');
  assert.equal(outbox.at(-1).payload.dailyPlanItemId, 'plan-item-A');
  assert.deepEqual(commits.at(-1).attempts.map(a => a.questionId), ['q-A']);
  assert.deepEqual(retired.slice(retireStart), ['question-set:set-A']);
  assert.equal(state.bundle.questionSet.id, 'set-B');
  assert.equal(state.submitted, false);
  assert.equal(state.submitting, false);
  assert.equal(state.review, undefined);

  // Submission boundary also rejects same-cycle/same-capability cross-thread input.
  const mismatchCount = commits.length;
  await assert.rejects(submitUseCase.execute({
    idempotencyKey: 'mismatch', questionSetId: 'set-A', learningThreadId: 'thread-B',
    questionIds: ['q-A'], startedAt: Date.now(), elapsedMs: 10, answers: [{ questionId: 'q-A', optionIds: [] }]
  }), /different learning thread/);
  assert.equal(commits.length, mismatchCount);

  // A committed paper whose draft cannot be retired is still submitted, and a
  // manifest that never restores earlier reviews does not reopen that draft.
  const manifests = { 'redo-1': { kind: content.LearningAssetKind.PracticeManifest, payload: { restorePrevious: false, sections: [
    { questionSetId: 'set-A', learningThreadId: 'thread-A', questionIds: ['q-A'] },
    { questionSetId: 'set-B', learningThreadId: 'thread-B', questionIds: ['q-B'] }
  ] } } };
  const normalRetire = assets.retireBusinessKey;
  const normalIdempotency = sessions.findByIdempotencyKey;
  assets.find = async id => manifests[id];
  sessions.findByIdempotencyKey = async key => commits.find(c => c.session.idempotencyKey === key);
  assets.retireBusinessKey = async () => { throw new Error('draft store busy'); };
  await router.push({ path: '/vue/practice/objective-session', query: { manifestId: 'redo-1' } }); await turn();
  assert.deepEqual(state.bundle.questions.map(q => q.id), ['q-A', 'q-B']);
  state.answers = { 'q-A': [baseContent.correctOptionId], 'q-B': [baseContent.correctOptionId] };
  const redoCommits = commits.length;
  await state.submit(); await turn();
  assert.equal(commits.length, redoCommits + 2, 'both sections commit');
  assert.equal(state.error, '', 'a failed draft retirement is not a failed submission');
  assert.equal(state.submissionPersisted, true);
  assert.equal(state.submitted, true);
  assert.ok(state.review);
  assert.deepEqual(state.reviewSessionIds, commits.slice(redoCommits).map(c => c.session.id));
  assert.equal(drafts.get('manifest:redo-1')?.status, 'draft', 'the probe really left a stale draft behind');
  await state.submit(); await turn();
  assert.equal(commits.length, redoCommits + 2, 'a submitted page cannot submit again');
  const reopen = async () => { await go('A'); await turn(); await router.push({ path: '/vue/practice/objective-session', query: { manifestId: 'redo-1' } }); await turn(); };
  await reopen();
  assert.deepEqual(state.answers, {}, 'the stale draft is not restored while it still cannot be retired');
  assert.equal(state.error, '');
  assets.retireBusinessKey = normalRetire;
  await reopen();
  assert.equal(drafts.has('manifest:redo-1'), false, 'the next load retires the stale draft');
  assert.deepEqual(state.answers, {});
  assert.equal(commits.length, redoCommits + 2);
  // An unfinished paper (only one section committed) keeps its draft answers.
  manifests['redo-2'] = manifests['redo-1'];
  commits.push({ session: { ...commits.at(-2).session, id: 'partial', idempotencyKey: 'practice:submit:redo-2:set-A:thread-A' }, attempts: [] });
  drafts.set('manifest:redo-2', { status: 'draft', payload: { ...draftWrites.at(-1).payload, answers: { 'q-B': [baseContent.correctOptionId] } } });
  await router.push({ path: '/vue/practice/objective-session', query: { manifestId: 'redo-2' } }); await turn();
  assert.deepEqual(state.answers, { 'q-B': [baseContent.correctOptionId] });
  assert.equal(drafts.has('manifest:redo-2'), true);
  commits.pop();
  sessions.findByIdempotencyKey = normalIdempotency;
  delete assets.find;

  // Unmount cancels an outstanding read and never resurrects the departed view.
  gate = deferred();
  contentRepository.findQuestionSet = async () => gate.promise;
  await go('A'); await turn();
  const leftSignal = state.sessionSignal;
  app.unmount(); app = undefined;
  assert.equal(leftSignal.aborted, true);
  gate.resolve(originalA); await turn();
  assert.equal(state.bundle, undefined);
  console.log('R13 UI regression passed: route reuse, late load/draft/enrichment, queued saves, submission switch, identity validation, unmount.');
} finally {
  if (app) app.unmount();
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
