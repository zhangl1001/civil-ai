import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const server = await createServer({ root, configFile: false, resolve: { alias: { '@': path.join(root, 'src') } }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
try {
  const agent = await server.ssrLoadModule('/src/modules/agent/public.ts');
  const conversation = await server.ssrLoadModule('/src/modules/conversation/public.ts');
  const ai = await server.ssrLoadModule('/src/capabilities/ai-runtime/public.ts');
  const aiConfig = await server.ssrLoadModule('/src/services/AIConfigService.ts');
  const taskToast = await server.ssrLoadModule('/src/components/TaskToastLifecycle.ts');
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
  assert.equal(aiConfig.normalizeAIConfig({
    provider: 'openai',
    apiKey: '',
    model: 'test-model'
  }).maxConcurrentTasks, 3);
  assert.equal(aiConfig.normalizeAIConfig({
    provider: 'openai',
    apiKey: '',
    model: 'test-model',
    maxConcurrentTasks: 1
  }).maxConcurrentTasks, 1);
  assert.equal(aiConfig.normalizeAIConfig({
    provider: 'openai',
    apiKey: '',
    model: 'test-model',
    maxConcurrentTasks: 9
  }).maxConcurrentTasks, 3);

  const concurrency = new agent.AdaptiveAgentConcurrency(3);
  assert.equal(concurrency.activeLimit, 3);
  concurrency.recordRetry();
  assert.equal(concurrency.activeLimit, 2);
  concurrency.recordRetry();
  assert.equal(concurrency.activeLimit, 1);
  concurrency.recordSuccess();
  assert.equal(concurrency.activeLimit, 1);
  concurrency.recordSuccess();
  assert.equal(concurrency.activeLimit, 2);
  concurrency.recordSuccess(4);
  assert.equal(concurrency.activeLimit, 3);
  concurrency.configure(1);
  assert.equal(concurrency.configuredLimit, 1);
  assert.equal(concurrency.activeLimit, 1);
  assert.equal(
    agent.resolveAgentWorkPool(agent.AgentRunType.ContentGeneration),
    agent.AgentWorkPool.ContentGeneration
  );
  assert.equal(
    agent.resolveAgentWorkPool(agent.AgentRunType.ErrorDiagnosis),
    agent.AgentWorkPool.Assessment
  );
  assert.equal(
    agent.resolveAgentWorkPool(
      agent.AgentRunType.TutorTurn,
      agent.TaskTargetType.BusinessOperation,
      { intent: 'essayGrade' }
    ),
    agent.AgentWorkPool.Assessment
  );
  assert.equal(
    agent.resolveAgentWorkPool(agent.AgentRunType.TutorTurn, agent.TaskTargetType.ChatTool),
    agent.AgentWorkPool.Interactive
  );
  assert.deepEqual(agent.agentWorkPoolsForLane(0, 3), [
    agent.AgentWorkPool.Interactive,
    agent.AgentWorkPool.Assessment,
    agent.AgentWorkPool.ContentGeneration,
    agent.AgentWorkPool.Background
  ]);
  assert.deepEqual(agent.agentWorkPoolsForLane(1, 3), [
    agent.AgentWorkPool.Assessment,
    agent.AgentWorkPool.Interactive,
    agent.AgentWorkPool.ContentGeneration,
    agent.AgentWorkPool.Background
  ]);
  assert.deepEqual(agent.agentWorkPoolsForLane(2, 3), [
    agent.AgentWorkPool.ContentGeneration,
    agent.AgentWorkPool.Interactive,
    agent.AgentWorkPool.Assessment,
    agent.AgentWorkPool.Background
  ]);
  assert.ok(
    [0, 1, 2].every((lane) => (
      agent.agentWorkPoolsForLane(lane, 3).includes(agent.AgentWorkPool.ContentGeneration)
    )),
    'all idle lanes must be able to steal content-generation work'
  );
  assert.notEqual(
    agent.agentWorkPoolsForLane(0, 1, 0)[0],
    agent.agentWorkPoolsForLane(0, 1, 1)[0],
    'single-lane scheduling must rotate foreground pools instead of starving one business line'
  );

  const streamedDeltas = [];
  const streamingRequests = [];
  const streamingInvocation = new agent.InvokeAgentModel(
    {
      async run(operation) { return operation({}); },
      async runAutocommit(operation) { return operation({}); }
    },
    {
      async findById() { return { run: running, events: [] }; },
      async appendInvocation() {},
      async updateInvocationResult() {},
      async updateInvocationValidation() {}
    },
    {
      now() { return 2_000; },
      monotonicNowMs() { return 2_000; }
    },
    { next() { return 'AiInvocationId:stream-test'; } }
  );
  await streamingInvocation.execute({
    agentRunId: running.id,
    modelRole: 'agent.tutor_turn',
    system: 'system',
    messages: [{ role: 'user', content: '生成练习' }],
    tools: [{
      name: 'generate_practice',
      description: '生成练习',
      inputSchema: { type: 'object', properties: {} }
    }],
    preferStream: true,
    onDelta(text) { streamedDeltas.push(text); }
  }, {
    provider: 'anthropic',
    model: 'test-model',
    async complete() {
      throw new Error('Tool-enabled Agent turn should use stream');
    },
    async stream(request, onEvent) {
      streamingRequests.push(request);
      await onEvent({ type: 'text_delta', text: '正在' });
      await onEvent({ type: 'text_delta', text: '处理' });
      return { text: '正在处理', usage: {} };
    }
  });
  assert.equal(streamingRequests[0].tools[0].name, 'generate_practice');
  assert.deepEqual(streamedDeltas, ['正在', '处理']);

  let protocolFallbackCalls = 0;
  await assert.rejects(
    streamingInvocation.execute({
      agentRunId: running.id,
      modelRole: 'agent.tutor_turn',
      system: 'system',
      messages: [{ role: 'user', content: '测试协议错误' }],
      preferStream: true,
      onDelta() {}
    }, {
      provider: 'anthropic',
      model: 'test-model',
      async complete() {
        protocolFallbackCalls += 1;
        return { text: '不应执行', usage: {} };
      },
      async stream() {
        throw new ai.ProviderGatewayError('invalid SSE', ai.ProviderErrorKind.Protocol);
      }
    }),
    /invalid SSE/
  );
  assert.equal(protocolFallbackCalls, 0);

  let unsupportedFallbackCalls = 0;
  const unsupportedStreamResult = await streamingInvocation.execute({
    agentRunId: running.id,
    modelRole: 'agent.tutor_turn',
    system: 'system',
    messages: [{ role: 'user', content: '测试供应商不支持流式' }],
    preferStream: true,
    onDelta(text) { streamedDeltas.push(text); }
  }, {
    provider: 'anthropic',
    model: 'test-model',
    async complete() {
      unsupportedFallbackCalls += 1;
      return { text: '兼容回复', usage: {} };
    },
    async stream() {
      throw new ai.ProviderGatewayError('stream is unsupported', ai.ProviderErrorKind.InvalidRequest);
    }
  });
  assert.equal(unsupportedFallbackCalls, 1);
  assert.equal(unsupportedStreamResult.text, '兼容回复');

  const workspaceLogs = new Map();
  const workspaceStorage = {
    async append(logKey, line) {
      workspaceLogs.set(logKey, `${workspaceLogs.get(logKey) || ''}${line}\n`);
    },
    async read(logKey) {
      return workspaceLogs.get(logKey) || '';
    },
    async delete(logKey) {
      workspaceLogs.delete(logKey);
    }
  };
  const messageLog = new conversation.ConversationMessageLog(workspaceStorage);
  const logMessage = {
    id: 'message:1',
    sessionId: 'session:1',
    role: 'assistant',
    content: '第一版',
    createdAt: 2_000
  };
  await messageLog.append(logMessage);
  await messageLog.replace({ ...logMessage, content: '最终回复' });
  assert.equal((await messageLog.list('session:1'))[0].content, '最终回复');
  await messageLog.deleteSession('session:1');
  assert.equal((await messageLog.list('session:1')).length, 0);

  const sessionLog = new conversation.ConversationSessionLog(workspaceStorage);
  await sessionLog.put({
    id: 'session:1',
    projectId: 'project:1',
    title: '第一轮',
    createdAt: 2_000,
    updatedAt: 2_000
  });
  await sessionLog.put({
    id: 'session:1',
    projectId: 'project:1',
    title: '第一轮复盘',
    createdAt: 2_000,
    updatedAt: 2_100
  });
  assert.equal((await sessionLog.get('session:1')).title, '第一轮复盘');
  await sessionLog.delete('session:1');
  assert.equal(await sessionLog.get('session:1'), undefined);

  const memories = new agent.FileAgentMemoryRepository(workspaceStorage);
  await memories.append({
    id: 'memory:global',
    layer: agent.AgentMemoryLayer.Semantic,
    memoryCode: 'tutor.response_preference',
    content: { style: 'socratic' },
    validFrom: 2_000
  });
  await memories.append({
    id: 'memory:session-1',
    sessionId: 'session:1',
    layer: agent.AgentMemoryLayer.Session,
    memoryCode: 'conversation.summary',
    content: { summary: '第一轮' },
    validFrom: 2_100
  });
  await memories.append({
    id: 'memory:session-2',
    sessionId: 'session:2',
    layer: agent.AgentMemoryLayer.Session,
    memoryCode: 'conversation.summary',
    content: { summary: '第二轮' },
    validFrom: 2_200
  });
  const sessionOneMemories = await memories.recall({
    sessionId: 'session:1',
    layers: [agent.AgentMemoryLayer.Semantic, agent.AgentMemoryLayer.Session],
    limit: 10,
    now: 3_000
  });
  assert.deepEqual(sessionOneMemories.map((record) => record.id), ['memory:session-1', 'memory:global']);
  await memories.append({
    id: 'memory:session-1-replacement',
    sessionId: 'session:1',
    layer: agent.AgentMemoryLayer.Session,
    memoryCode: 'conversation.summary',
    content: { summary: '更新后的第一轮' },
    validFrom: 2_300
  });
  await memories.supersede('memory:session-1', 'memory:session-1-replacement');
  assert.deepEqual(
    (await memories.recall({
      sessionId: 'session:1',
      layers: [agent.AgentMemoryLayer.Session],
      limit: 10,
      now: 3_000
    })).map((record) => record.id),
    ['memory:session-1-replacement']
  );
  await memories.forgetSession('session:1');
  await memories.append({
    id: 'memory:late-session-1',
    sessionId: 'session:1',
    layer: agent.AgentMemoryLayer.Session,
    memoryCode: 'conversation.late_write',
    content: { summary: '迟到写入' },
    validFrom: 2_400
  });
  assert.equal((await memories.recall({
    sessionId: 'session:1',
    layers: [agent.AgentMemoryLayer.Session],
    limit: 10,
    now: 3_000
  })).length, 0);
  assert.equal((await memories.recall({
    sessionId: 'session:2',
    layers: [agent.AgentMemoryLayer.Session],
    limit: 10,
    now: 3_000
  }))[0].id, 'memory:session-2');

  const viewQuery = new agent.GetAgentRunViews({
    async listRecent(limit) {
      assert.equal(limit, 5);
      return [{ run: completed, events: [{ id: 'event:1', agentRunId: completed.id, eventType: 'completed', toStatus: 'completed', reasonCode: 'agent_run.done', payload: {}, occurredAt: 1001, idempotencyKey: 'event:1' }] }];
    },
    async countInvocations(runIds) {
      assert.deepEqual(runIds, [completed.id]);
      return { [completed.id]: 1 };
    }
  });
  const views = await viewQuery.execute({ limit: 5 });
  assert.equal(views[0].title, 'AI 错因分析');
  assert.equal(views[0].statusText, '已完成');
  assert.equal(views[0].detail, '已形成错因候选，可在题目解析下查看');
  assert(!views[0].detail.includes('ErrorDiagnosisId:'), 'task detail must not expose internal resource ids');
  assert.equal(views[0].invocationCount, 1);
  let localHandlerExecuted = false;
  const localRun = {
    run: { ...queued, id: 'run:local', runType: agent.AgentRunType.TutorTurn },
    events: []
  };
  let claimedWorkPools = [];
  const localBatch = new agent.RunTutorAgentBatch(
    {
      async execute(command) {
        claimedWorkPools = command.workPools;
        return [localRun];
      }
    },
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
  const localResult = await localBatch.execute({
    workerId: 'local-worker',
    workPools: [agent.AgentWorkPool.Interactive]
  });
  assert.equal(localHandlerExecuted, true);
  assert.equal(localResult.completed, 1);
  assert.deepEqual(claimedWorkPools, [agent.AgentWorkPool.Interactive]);

  const retryTransitions = [];
  const generationFailure = Object.assign(new Error('generation process interrupted'), {
    code: 'generation.process_interrupted'
  });
  const retryBatch = new agent.RunTutorAgentBatch(
    { async execute() { return []; } },
    { async execute() { return []; } },
    { async execute(command) { retryTransitions.push(command); } },
    clock,
    [{
      runType: agent.AgentRunType.ContentGeneration,
      async execute() {
        throw generationFailure;
      }
    }]
  );
  const retryRun = {
    run: {
      ...queued,
      id: 'run:generation-retry',
      runType: agent.AgentRunType.ContentGeneration,
      status: agent.AgentRunStatus.Running,
      attemptCount: 1
    },
    events: []
  };
  const retryResult = await retryBatch.executeRuns([retryRun]);
  assert.equal(retryResult.retried, 1);
  assert.equal(retryTransitions[0].action, agent.AgentRunAction.Retry);
  assert.equal(retryTransitions[0].errorCode, 'generation.process_interrupted');
  assert.equal(retryTransitions[0].payload.retryAfterMs, 500);

  retryTransitions.length = 0;
  const unexpectedAbort = new DOMException('request was interrupted', 'AbortError');
  const abortRetryBatch = new agent.RunTutorAgentBatch(
    { async execute() { return []; } },
    { async execute() { return []; } },
    { async execute(command) { retryTransitions.push(command); } },
    clock,
    [{
      runType: agent.AgentRunType.ContentGeneration,
      async execute() {
        throw unexpectedAbort;
      }
    }]
  );
  const abortRetryResult = await abortRetryBatch.executeRuns([retryRun]);
  assert.equal(abortRetryResult.retried, 1);
  assert.equal(retryTransitions[0].action, agent.AgentRunAction.Retry);
  assert.equal(retryTransitions[0].errorCode, 'provider.transient');
  assert.equal(retryTransitions[0].payload.retryAfterMs, 1000);

  retryTransitions.length = 0;
  const exhaustedResult = await retryBatch.executeRuns([{
    ...retryRun,
    run: { ...retryRun.run, attemptCount: 2 }
  }]);
  assert.equal(exhaustedResult.failed, 1);
  assert.equal(retryTransitions[0].action, agent.AgentRunAction.Fail);
  assert.equal(retryTransitions[0].errorCode, 'generation.process_interrupted');

  retryTransitions.length = 0;
  generationFailure.code = 'generation.json_invalid';
  const invalidStructureResult = await retryBatch.executeRuns([retryRun]);
  assert.equal(invalidStructureResult.failed, 1);
  assert.equal(retryTransitions[0].action, agent.AgentRunAction.Fail);
  assert.equal(retryTransitions[0].errorCode, 'generation.json_invalid');

  const toastLifecycle = new taskToast.TaskToastLifecycle();
  const historicalRun = { id: 'run:historical', status: agent.AgentRunStatus.Completed };
  assert.deepEqual(toastLifecycle.observe(false, [historicalRun]), []);
  assert.deepEqual(
    toastLifecycle.observe(true, [historicalRun]),
    [],
    'initial task snapshot must not replay historical completion toasts'
  );
  assert.deepEqual(toastLifecycle.observe(true, [historicalRun]), []);
  const newRun = { id: 'run:new', status: agent.AgentRunStatus.Running };
  assert.deepEqual(toastLifecycle.observe(true, [historicalRun, newRun]), [newRun]);
  const finishedRun = { ...newRun, status: agent.AgentRunStatus.Completed };
  assert.deepEqual(toastLifecycle.observe(true, [historicalRun, finishedRun]), [finishedRun]);
  console.log('Agent runtime verification passed.');
} finally { await server.close(); }
