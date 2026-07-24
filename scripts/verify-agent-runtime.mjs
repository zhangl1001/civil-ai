import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const server = await createServer({ root, configFile: false, resolve: { alias: { '@': path.join(root, 'src') } }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
try {
  const agent = await server.ssrLoadModule('/src/modules/agent/public.ts');
  const clock = { value: 1000, now() { return ++this.value; } };
  const machine = new agent.AgentRunMachine();
  const queued = { id: 'run:1', runType: agent.AgentRunType.ErrorDiagnosis, status: agent.AgentRunStatus.Queued, inputSnapshot: {}, checkpoint: {}, attemptCount: 0, idempotencyKey: 'run:1', createdAt: 1000, updatedAt: 1000, version: 1 };
  const running = machine.transition(queued, agent.AgentRunAction.Start, clock);
  assert.equal(running.status, 'running');
  assert.equal(running.attemptCount, 1);
  const retried = machine.transition(running, agent.AgentRunAction.Retry, clock, { errorCode: 'provider.rate_limited', nextRunAt: 10_000 });
  assert.equal(retried.status, 'queued');
  assert.equal(retried.errorCode, 'provider.rate_limited');
  assert.equal(retried.nextRunAt, 10_000);
  const waiting = machine.transition(running, agent.AgentRunAction.WaitForUser, clock);
  const resumed = machine.transition(waiting, agent.AgentRunAction.Resume, clock);
  assert.equal(resumed.attemptCount, 2);
  const completed = machine.transition(resumed, agent.AgentRunAction.Complete, clock);
  assert.equal(completed.status, 'completed');
  assert.throws(() => machine.transition(completed, agent.AgentRunAction.Resume, clock));
  assert.equal(agent.DEFAULT_MAX_CONCURRENT_AGENT_RUNS, 3);
  const viewQuery = new agent.GetAgentRunViews({
    async listRecent(limit) {
      assert.equal(limit, 5);
      return [{ run: completed, events: [{ id: 'event:1', agentRunId: completed.id, eventType: 'completed', toStatus: 'completed', reasonCode: 'agent_run.done', payload: {}, occurredAt: 1001, idempotencyKey: 'event:1' }] }];
    },
    async listInvocations(runId) {
      assert.equal(runId, completed.id);
      return [{ id: 'invocation:1', agentRunId: completed.id, provider: 'test', model: 'test-model', modelRole: 'diagnosis', requestHash: 'hash', validationStatus: 'valid', createdAt: 1002 }];
    }
  });
  const views = await viewQuery.execute({ limit: 5 });
  assert.equal(views[0].title, 'AI 错因分析');
  assert.equal(views[0].statusText, '已完成');
  assert.equal(views[0].invocationCount, 1);
  let localHandlerExecuted = false;
  const localRun = {
    run: { ...queued, id: 'run:local', runType: agent.AgentRunType.TutorTurn },
    events: []
  };
  const localBatch = new agent.RunTutorAgentBatch(
    { async execute() { return [localRun]; } },
    { async execute() { return []; } },
    { async execute() { throw new Error('Local handler should not transition through the fake transition port'); } },
    clock,
    [{
      runType: agent.AgentRunType.TutorTurn,
      async execute(run, gateway) {
        assert.equal(run.run.id, 'run:local');
        assert.equal(gateway, undefined);
        localHandlerExecuted = true;
      }
    }]
  );
  const localResult = await localBatch.execute({ workerId: 'local-worker' });
  assert.equal(localHandlerExecuted, true);
  assert.equal(localResult.completed, 1);
  console.log('Agent runtime verification passed.');
} finally { await server.close(); }
