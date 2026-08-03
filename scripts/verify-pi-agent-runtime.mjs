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
  const agent = await server.ssrLoadModule('/src/modules/agent/public.ts');
  const pi = await server.ssrLoadModule('/src/modules/agent/application/PiAgentLoopRuntime.ts');
  const ai = await server.ssrLoadModule('/src/capabilities/ai-runtime/public.ts');
  await verifiesMultiTurnToolLoop(agent, pi, ai);
  await verifiesParallelReads(agent, pi, ai);
  await verifiesConfirmationResume(agent, pi, ai);
  await verifiesConfirmationFreezesSiblingTools(agent, pi, ai);
  await verifiesCancellation(agent, pi, ai);
  await verifiesProviderFailureIdentity(agent, pi, ai);
  await verifiesNullFinalTextRecovery(agent, pi, ai);
  await verifiesSideEffectFreeStableFallback(agent, ai, server);
  console.log('Pi Agent runtime verification passed.');
} finally {
  await server.close();
}

async function verifiesMultiTurnToolLoop(agent, pi, ai) {
  const events = [];
  const saved = [];
  const invocations = [];
  const invoker = sequenceInvoker([
    {
      text: '',
      toolCalls: [{ id: 'call:read', name: 'practice_read', arguments: { scope: 'today' } }],
      usage: {}
    },
    { text: '今天有一套待练题组。', usage: {} }
  ], invocations);
  const runtime = new pi.PiAgentLoopRuntime(
    invoker,
    allowPolicy(),
    {
      async execute(_definition, call) {
        assert.equal(call.name, 'practice.read');
        return { content: '{"count":1}', madeProgress: true };
      }
    },
    { async save(checkpoint) { saved.push(checkpoint); } },
    { onEvent(event) { events.push(event); } }
  );
  const result = await runtime.execute(command({
    tools: [readTool('practice.read')]
  }), gateway(ai));
  assert.equal(result.status, 'completed');
  assert.equal(result.text, '今天有一套待练题组。');
  assert.equal(invocations.length, 2, 'Pi must continue after observing a Tool result');
  assert.equal(saved.length >= 2, true, 'each turn and final state must be checkpointed');
  assert.equal(events.some((event) => event.type === 'tool_call_succeeded'), true);
}

async function verifiesParallelReads(agent, pi, ai) {
  let active = 0;
  let maxActive = 0;
  const runtime = new pi.PiAgentLoopRuntime(
    sequenceInvoker([
      {
        text: '',
        toolCalls: [
          { id: 'call:a', name: 'source_a', arguments: {} },
          { id: 'call:b', name: 'source_b', arguments: {} }
        ],
        usage: {}
      },
      { text: '检索完成。', usage: {} }
    ]),
    allowPolicy(),
    {
      async execute() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(20);
        active -= 1;
        return { content: 'evidence', madeProgress: true };
      }
    },
    { async save() {} }
  );
  await runtime.execute(command({
    tools: [readTool('source.a'), readTool('source.b')]
  }), gateway(ai));
  assert.equal(maxActive, 2, 'independent read Tools should execute concurrently');
}

async function verifiesConfirmationResume(agent, pi, ai) {
  let executions = 0;
  const checkpoints = [];
  const tool = { ...readTool('content.publish'), risk: agent.AgentToolRisk.Write, requiresConfirmation: true };
  const runtime = new pi.PiAgentLoopRuntime(
    sequenceInvoker([{
      text: '准备发布。',
      toolCalls: [{ id: 'call:publish', name: 'content_publish', arguments: { id: 'draft:1' } }],
      usage: {}
    }]),
    {
      async evaluate(definition) {
        return definition.requiresConfirmation
          ? { decision: 'confirm', reasonCode: 'policy.confirm' }
          : { decision: 'allow', reasonCode: 'policy.allow' };
      }
    },
    {
      async execute() {
        executions += 1;
        return { content: 'published', resultRef: 'content:1', madeProgress: true };
      }
    },
    { async save(checkpoint) { checkpoints.push(checkpoint); } }
  );
  const first = await runtime.execute(command({ tools: [tool] }), gateway(ai));
  assert.equal(first.status, 'waiting_user');
  assert.equal(executions, 0, 'confirmation-gated Tool must not execute before confirmation');
  assert.equal(first.checkpoint.pendingConfirmation?.name, 'content.publish');

  const resumed = new pi.PiAgentLoopRuntime(
    sequenceInvoker([{ text: '已经发布。', usage: {} }]),
    allowPolicy(),
    {
      async execute() {
        executions += 1;
        return { content: 'published', resultRef: 'content:1', madeProgress: true };
      }
    },
    { async save(checkpoint) { checkpoints.push(checkpoint); } }
  );
  const second = await resumed.execute(command({
    tools: [tool],
    checkpoint: first.checkpoint,
    confirmationDecision: 'confirm'
  }), gateway(ai));
  assert.equal(second.status, 'completed');
  assert.equal(executions, 1, 'confirmed Tool executes exactly once');
}

async function verifiesConfirmationFreezesSiblingTools(agent, pi, ai) {
  const executed = [];
  const runtime = new pi.PiAgentLoopRuntime(
    sequenceInvoker([{
      text: '',
      toolCalls: [
        { id: 'call:publish', name: 'content_publish', arguments: {} },
        { id: 'call:read', name: 'practice_read', arguments: {} }
      ],
      usage: {}
    }]),
    {
      async evaluate(definition) {
        return definition.requiresConfirmation
          ? { decision: 'confirm', reasonCode: 'policy.confirm' }
          : { decision: 'allow', reasonCode: 'policy.allow' };
      }
    },
    {
      async execute(definition) {
        executed.push(definition.name);
        return { content: 'unexpected', madeProgress: true };
      }
    },
    { async save() {} }
  );
  const result = await runtime.execute(command({
    tools: [
      { ...readTool('content.publish'), risk: agent.AgentToolRisk.Write, requiresConfirmation: true },
      readTool('practice.read')
    ]
  }), gateway(ai));
  assert.equal(result.status, 'waiting_user');
  assert.deepEqual(executed, [], 'a pending confirmation must freeze later sibling Tools in the same turn');
}

async function verifiesCancellation(agent, pi, ai) {
  const controller = new AbortController();
  const runtime = new pi.PiAgentLoopRuntime(
    {
      async invoke(_invocation, _gateway, signal) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 200);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason || new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
        return { text: 'late', usage: {} };
      }
    },
    allowPolicy(),
    { async execute() { return { content: '' }; } },
    { async save() {} }
  );
  const promise = runtime.execute(command({ tools: [] }), gateway(ai), controller.signal);
  setTimeout(() => controller.abort(new DOMException('Aborted', 'AbortError')), 10);
  await assert.rejects(promise, /Aborted|Agent 模型调用失败/);
}

async function verifiesProviderFailureIdentity(agent, pi, ai) {
  const failure = new ai.ProviderGatewayError(
    'native transport unavailable',
    ai.ProviderErrorKind.Transient
  );
  const runtime = new pi.PiAgentLoopRuntime(
    { async invoke() { throw failure; } },
    allowPolicy(),
    { async execute() { return { content: '' }; } },
    { async save() {} }
  );
  await assert.rejects(
    runtime.execute(command({ tools: [] }), gateway(ai)),
    (error) => error === failure,
    'Pi must preserve ProviderGatewayError identity and classification'
  );
}

async function verifiesNullFinalTextRecovery(agent, pi, ai) {
  const invocations = [];
  const runtime = new pi.PiAgentLoopRuntime(
    sequenceInvoker([
      { text: null, usage: {} },
      { text: '空最终文本已恢复。', usage: {} }
    ], invocations),
    allowPolicy(),
    { async execute() { return { content: '' }; } },
    { async save() {} }
  );
  const result = await runtime.execute(command({ tools: [] }), gateway(ai));
  assert.equal(result.status, 'completed');
  assert.equal(result.text, '空最终文本已恢复。');
  assert.equal(invocations.length, 2, 'an empty final response gets one constrained repair turn');
}

async function verifiesSideEffectFreeStableFallback(agent, ai, server) {
  const lazy = await server.ssrLoadModule('/src/modules/agent/application/LazyPiAgentLoopRuntime.ts');
  const invocations = [];
  const runtime = new lazy.LazyPiAgentLoopRuntime(
    {
      async invoke() {
        invocations.push(true);
        if (invocations.length === 1) throw new TypeError('Pi adapter failed before provider effects');
        return { text: '稳定循环已接管。', usage: {} };
      }
    },
    allowPolicy(),
    { async execute() { return { content: '' }; } },
    { async save() {} }
  );
  const result = await runtime.execute(command({ tools: [] }), gateway(ai));
  assert.equal(result.status, 'completed');
  assert.equal(result.text, '稳定循环已接管。');
  assert.equal(invocations.length, 2, 'fallback must reuse the request exactly once');
}

function command(overrides = {}) {
  return {
    agentRunId: 'AgentRunId:pi-test',
    system: '你是测试 Agent。',
    messages: [{ role: 'user', content: '执行任务' }],
    tools: [],
    executionContext: { agentRunId: 'AgentRunId:pi-test' },
    preferStream: true,
    ...overrides
  };
}

function readTool(name) {
  return {
    name,
    description: `读取 ${name} 的最小必要数据。`,
    inputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: { scope: { type: 'string' }, id: { type: 'string' } }
    },
    risk: 'read',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  };
}

function sequenceInvoker(responses, invocations = []) {
  let index = 0;
  return {
    async invoke(invocation) {
      invocations.push(invocation);
      const response = responses[index++];
      if (!response) throw new Error('Unexpected extra model turn');
      if (response.text) await invocation.onDelta?.(response.text);
      return response;
    }
  };
}

function allowPolicy() {
  return { async evaluate() { return { decision: 'allow', reasonCode: 'policy.allow' }; } };
}

function gateway(ai) {
  return {
    provider: ai.ProviderCode.Anthropic,
    model: 'test-model',
    capabilities: { multimodalInput: true },
    async complete() { throw new Error('The fake invoker owns model responses'); }
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
