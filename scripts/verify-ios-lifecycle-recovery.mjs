import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

globalThis.document ??= { hidden: false };

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
  const { TutorDatabaseLifecycleCoordinator } = await server.ssrLoadModule(
    '/src/composition-root/database/TutorDatabaseLifecycleCoordinator.ts'
  );

  const lifecycle = createFakeLifecycle();
  const timers = createFakeTimers();
  const recoveryGate = deferred();
  const calls = [];
  const runtime = createRuntime({
    recoverAfterInterruption: async (reason) => {
      calls.push(`database:${reason}`);
      await recoveryGate.promise;
    },
    recoverExpiredAgentRuns: async () => calls.push('agent-runs')
  });
  const coordinator = new TutorDatabaseLifecycleCoordinator(dependencies(lifecycle, timers));
  coordinator.install(runtime);
  assert.equal(timers.pendingCount, 1, 'Active native runtime schedules one health check');

  lifecycle.emit('background', 'app-did-enter-background');
  assert.equal(timers.pendingCount, 0, 'Background transition cancels the health timer');
  lifecycle.emit('active', 'app-did-become-active');
  const readiness = coordinator.waitUntilReady();
  lifecycle.emit('active', 'focus');
  assert.deepEqual(calls, ['database:resume.app-did-become-active'], 'Concurrent active signals share one recovery');
  recoveryGate.resolve();
  await readiness;
  assert.deepEqual(calls, ['database:resume.app-did-become-active', 'agent-runs']);
  assert.equal(timers.pendingCount, 1, 'Health checks resume only after database and agent recovery finish');
  coordinator.dispose();

  const failedLifecycle = createFakeLifecycle();
  const failedTimers = createFakeTimers();
  let attempts = 0;
  const failedCoordinator = new TutorDatabaseLifecycleCoordinator(dependencies(failedLifecycle, failedTimers));
  failedCoordinator.install(createRuntime({
    recoverAfterInterruption: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('bridge interrupted');
    }
  }));
  failedLifecycle.emit('background', 'app-did-enter-background');
  failedLifecycle.emit('active', 'app-did-become-active');
  await assert.rejects(() => failedCoordinator.waitUntilReady(), /bridge interrupted/);
  await assert.rejects(
    () => failedCoordinator.waitUntilReady(),
    /recovery is pending/,
    'Workers must remain blocked after a failed recovery'
  );
  failedLifecycle.emit('active', 'focus');
  await failedCoordinator.waitUntilReady();
  assert.equal(attempts, 2, 'A failed recovery remains interrupted and retries on the next active signal');
  failedCoordinator.dispose();

  const healthLifecycle = createFakeLifecycle();
  const healthTimers = createFakeTimers();
  const healthCalls = [];
  const healthCoordinator = new TutorDatabaseLifecycleCoordinator(dependencies(healthLifecycle, healthTimers));
  healthCoordinator.install(createRuntime({
    healthCheck: async () => {
      healthCalls.push('health');
      throw new Error('database stalled');
    },
    recoverAfterInterruption: async (reason) => healthCalls.push(`recover:${reason}`),
    recoverExpiredAgentRuns: async () => healthCalls.push('agent-runs')
  }));
  await healthTimers.runNext();
  await healthCoordinator.waitUntilReady();
  assert.deepEqual(healthCalls, ['health', 'recover:health_check_failed', 'agent-runs']);
  healthCoordinator.dispose();

  console.log('iOS lifecycle recovery verification passed.');
} finally {
  await server.close();
}

function createFakeLifecycle() {
  let event = { state: 'active', reason: 'visibility', at: 1 };
  const listeners = new Set();
  return {
    current: () => event,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(state, reason) {
      event = { state, reason, at: event.at + 1 };
      listeners.forEach((listener) => listener(event));
    }
  };
}

function createFakeTimers() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    get pendingCount() { return callbacks.size; },
    setTimeout(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout(id) { callbacks.delete(id); },
    async runNext() {
      const entry = callbacks.entries().next().value;
    assert(entry, 'Expected one scheduled callback');
    callbacks.delete(entry[0]);
    entry[1]();
    await Promise.resolve();
    }
  };
}

function dependencies(lifecycle, timers) {
  return {
    isNativePlatform: () => true,
    lifecycle,
    isDocumentHidden: () => false,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    healthCheckIntervalMs: 10,
    logger: { warn: () => undefined, error: () => undefined }
  };
}

function createRuntime(overrides = {}) {
  return {
    databaseLifecycle: {
      waitUntilReady: async () => undefined,
      recoverAfterInterruption: overrides.recoverAfterInterruption ?? (async () => undefined),
      healthCheck: overrides.healthCheck ?? (async () => undefined)
    },
    recoverExpiredAgentRuns: {
      execute: overrides.recoverExpiredAgentRuns ?? (async () => [])
    }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}
