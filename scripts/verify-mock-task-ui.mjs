// Adapted from ui-second-pass/probe-nav.mjs with correct-result assertions; original evidence is preserved.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import vuePlugin from '../web/node_modules/@vitejs/plugin-vue/dist/index.mjs';

const root = new URL('../web', import.meta.url).pathname;
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mock-ui-'));
const require = createRequire(`${root}/package.json`);
const vue = require('vue');
const intervals = new Map();
let seq = 0;
globalThis.window = { setInterval(fn) { const id = ++seq; intervals.set(id, fn); return id; }, clearInterval(id) { intervals.delete(id); } };
globalThis.__audit = {};
const server = await createServer({ root, configFile: false, cacheDir: `${dir}/vite-cache`,
  plugins: [{ name: 'audit-local-dependencies', enforce: 'pre',
    resolveId(id) { if (id === 'virtual:audit-router') return '\0audit-router'; },
    load(id) {
      if (id === '\0audit-router') return 'export const useRouter = () => globalThis.__audit.router;';
      if (id === `${root}/src/composition-root/public.ts`) return 'export const initializeTutorRuntime = async () => globalThis.__audit.runtime; export const agentWorkerCoordinator = { start() {} };';
      if (id === `${root}/src/services/ExamFlowService.ts`) return 'export const examFlowService = globalThis.__audit.flow;';
    },
    transform(src, id) { if (id === `${root}/src/views/ExamView.vue`) return src.replace("from 'vue-router'", "from 'virtual:audit-router'"); }
  }, vuePlugin()], resolve: { alias: { '@': `${root}/src` } },
  server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom'
});
const renderer = vue.createRenderer({ insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} });
const turn = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };
const subjects = [{ code: 'aptitude', name: '行测', deliveryKind: 'objective', mockExam: { schemes: [] } }, { code: 'essay', name: '申论', deliveryKind: 'subjective', mockExam: { schemes: [] } }];
const task = { id: 'mock-A', isActive: true, status: 'running' };
const completed = { ...task, isActive: false, status: 'completed', actionRoute: '/vue/practice/objective-session', actionParams: { manifestId: 'expected-manifest-A' } };
const dashboard = (code = 'aptitude') => ({ subjects, subject: subjects.find(s => s.code === code), history: code === 'aptitude' ? [{ id: 'expected-manifest-A', manifestId: 'expected-manifest-A' }] : [{ id: 'old-essay', questionSetId: 'old-essay', date: '2026-09-29', title: '旧申论模考', essayEntryMode: 'self', essayType: 'short', essayTopic: 'old', essayPurpose: 'mock' }] });
let delayedDashboard;
const pushes = [];
globalThis.__audit.router = { push(to) { pushes.push(to); return Promise.resolve(); } };
globalThis.__audit.flow = { dashboard: async code => delayedDashboard ? delayedDashboard.promise : dashboard(code), readContext: s => ({ subjectCode: s.code, date: '2026-09-30', questionCount: 5, durationMinutes: 10, tags: [], essayType: 'short' }), writeContext() {}, startMock: async () => ({ task, reused: false }) };
globalThis.__audit.runtime = { getAgentRunViews: { findById: async () => completed } };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let mounted;
try {
  const { default: Exam } = await server.ssrLoadModule('/src/views/ExamView.vue');
  const { useMockTaskFollow } = await server.ssrLoadModule('/src/features/exam/useMockTaskFollow.ts');
  Exam.render = () => null;
  const mount = (component = Exam) => {
    const app = renderer.createApp(component); app.provide(vue.ssrContextKey, {});
    const instance = app.mount({}); return { app, state: instance.$.setupState };
  };
  mounted = mount(); await turn();
  await mounted.state.startExam();
  await mounted.state.switchSubject(subjects[1]);
  intervals.values().next().value(); await turn();
  assert.deepEqual(pushes, [{ path: completed.actionRoute, query: completed.actionParams }], 'completed aptitude task opens its own manifest after switching to essay');
  mounted.app.unmount();

  // A completion read that returns after unmount cannot navigate.
  pushes.length = 0;
  const delayedRead = deferred();
  globalThis.__audit.runtime.getAgentRunViews.findById = () => delayedRead.promise;
  mounted = mount(); await turn();
  await mounted.state.startExam();
  intervals.values().next().value(); await turn();
  mounted.app.unmount();
  delayedRead.resolve(completed); await turn();
  assert.equal(intervals.size, 0);
  assert.equal(pushes.length, 0);

  // Slow completion handlers carry cancellation through each await.
  let callbackGate = deferred();
  let callbackStarted = 0;
  let callbackSignal;
  let controls;
  const Follower = {
    setup() {
      controls = useMockTaskFollow(async (done, signal) => {
        callbackStarted++; callbackSignal = signal;
        await callbackGate.promise;
        if (!signal.aborted) pushes.push(done.id);
      }, () => {});
      return () => null;
    }
  };
  globalThis.__audit.runtime.getAgentRunViews.findById = async () => completed;
  mounted = mount(Follower);
  controls.follow(task);
  const poll = intervals.values().next().value;
  poll(); poll(); await turn();
  assert.equal(callbackStarted, 1, 'overlapping polls consume a completion once');
  assert.equal(callbackSignal.aborted, false);
  mounted.app.unmount();
  assert.equal(callbackSignal.aborted, true);
  callbackGate.resolve(); await turn();
  assert.equal(pushes.length, 0, 'already-started callback cannot navigate after unmount');

  // Re-following even the same task cancels the old callback generation.
  callbackGate = deferred(); callbackStarted = 0;
  mounted = mount(Follower);
  controls.follow(task); intervals.values().next().value(); await turn();
  const previousSignal = callbackSignal;
  controls.follow(task);
  assert.equal(previousSignal.aborted, true);
  callbackGate.resolve(); await turn();
  assert.equal(pushes.length, 0);
  intervals.values().next().value(); await turn();
  assert.deepEqual(pushes, [task.id]);
  mounted.app.unmount();

  // A dispatch promise resolving after unmount must not restart polling.
  pushes.length = 0;
  const dispatch = deferred();
  globalThis.__audit.flow.startMock = () => dispatch.promise;
  mounted = mount(); await turn();
  const starting = mounted.state.startExam();
  mounted.app.unmount();
  dispatch.resolve({ task, reused: false }); await starting; await turn();
  assert.equal(intervals.size, 0);

  // Subjective tasks keep their own result route and essay metadata too.
  globalThis.__audit.flow.startMock = async () => ({ task, reused: false });
  const essayDone = { ...completed, actionRoute: '/vue/essay', actionParams: { questionSetId: 'new-essay', type: 'long', purpose: 'mock' } };
  globalThis.__audit.runtime.getAgentRunViews.findById = async () => essayDone;
  mounted = mount(); await turn();
  await mounted.state.switchSubject(subjects[1]);
  await mounted.state.startExam();
  await mounted.state.switchSubject(subjects[0]);
  intervals.values().next().value(); await turn();
  assert.deepEqual(pushes, [{ path: essayDone.actionRoute, query: essayDone.actionParams }]);
  mounted.app.unmount();
  console.log('R15/R16 UI regression passed: task-bound objective/essay routes, query/callback cancellation, duplicate polls, same-task replacement, late dispatch.');
} finally {
  mounted?.app.unmount();
  await server.close();
  await fs.rm(dir, { recursive: true, force: true });
}
