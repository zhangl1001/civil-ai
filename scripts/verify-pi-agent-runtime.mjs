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
  await verifiesNoFallbackAfterInvocation(ai, server);
  await verifiesFirstTurnStreaming(agent, pi, ai);
  await verifiesToolTurnTextIsProvisional(agent, pi, ai);
  await verifiesOutputLimitHandling(agent, pi, ai);
  await verifiesThinkingReplayThroughPi(pi, ai, server);
  await verifiesBoundThinkingLoops(agent, pi, ai);
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
  let starts = 0;
  const runtime = new lazy.LazyPiAgentLoopRuntime(
    {
      async invoke() {
        invocations.push(true);
        return { text: '稳定循环已接管。', usage: {} };
      }
    },
    allowPolicy(),
    { async execute() { return { content: '' }; } },
    { async save() {} },
    { onEvent(event) {
      if (event.type === 'run_started' && ++starts === 1) throw new TypeError('Pi initialization failed before invocation');
    } }
  );
  const result = await runtime.execute(command({ tools: [] }), gateway(ai));
  assert.equal(result.status, 'completed');
  assert.equal(result.text, '稳定循环已接管。');
  assert.equal(invocations.length, 1, 'initialization fallback sends only one model request');
}

// R2: derived from fallback-ledger-probe; the audit evidence remains untouched.
async function verifiesNoFallbackAfterInvocation(ai, server) {
  const { LazyPiAgentLoopRuntime } = await server.ssrLoadModule('/src/modules/agent/application/LazyPiAgentLoopRuntime.ts');
  const { InvokeAgentModel } = await server.ssrLoadModule('/src/modules/agent/application/InvokeAgentModel.ts');
  const { TutorDatabaseBusyError } = await server.ssrLoadModule('/src/capabilities/database/public.ts');
  for (const streaming of [false, true]) {
    let providerCalls = 0, toolEffects = 0, resultWrites = 0, id = 0;
    const failure = new TutorDatabaseBusyError('transaction.lock_wait');
    const invoker = new InvokeAgentModel({ async run(fn) { return fn({}); }, async runAutocommit(fn) { return fn({}); } }, {
      async findById() { return { run: { status: 'running' } }; },
      async appendInvocation() {},
      async updateInvocationResult() { resultWrites++; throw failure; },
      async updateInvocationValidation() {}
    }, { now() { return 1; }, monotonicNowMs() { return 1; } }, { next() { return `invocation:${++id}`; } });
    const complete = async () => {
      providerCalls++;
      return { text: '', toolCalls: [{ id: 'call:1', name: 'practice_read', arguments: {} }], usage: {} };
    };
    const selected = { ...gateway(ai), complete, stream: complete };
    const runtime = new LazyPiAgentLoopRuntime(invoker, allowPolicy(), {
      async execute() { toolEffects++; return { content: '{}', madeProgress: true }; }
    }, { async save() {} });
    await assert.rejects(runtime.execute(command({ tools: [readTool('practice.read')], preferStream: streaming }), selected), error => error === failure);
    assert.equal(providerCalls, 1, 'ledger failure after a paid response never replays the model through another engine');
    assert.equal(resultWrites, 1);
    assert.equal(toolEffects, 0);
  }
  let invocations = 0;
  const failure = new TypeError('failure after request dispatch with no visible text');
  const runtime = new LazyPiAgentLoopRuntime({ async invoke() { invocations++; throw failure; } },
    allowPolicy(), { async execute() { assert.fail('unexpected tool'); } }, { async save() {} });
  await assert.rejects(runtime.execute(command(), gateway(ai)), error => error === failure);
  assert.equal(invocations, 1, 'absence of visible text does not prove invocation is safe to repeat');
}

// R1/R4: the original audit asserted failure; these tests require both engines to finish.
async function verifiesBoundThinkingLoops(agent, pi, ai) {
  const call = (name, id) => ({ type: 'tool_use', name, id, input: {} });
  const answer = { type: 'text', text: 'Done' };
  const selector = { ...readTool('skill.load'), role: 'skill_selector' };
  const read = readTool('practice.read');
  const write = { ...readTool('practice.generate'), risk: 'write' };
  const verify = { ...readTool('task.verify'), role: 'completion_verifier' };
  const scan = readTool('question_bank.scan');
  const skill = { name: 'practice', version: '1', instructions: 'Read practice first.', allowedTools: [write.name, verify.name], validatorNames: ['agent.no-false-completion'], requiresOperationalTool: true, executionBudget: 'standard' };
  for (const Runtime of [pi.PiAgentLoopRuntime, agent.RunAgentLoop]) {
    async function run(tools, responses, executor, extras = {}) {
      const bodies = [], bindings = new Map(), effects = [];
      let mismatches = 0;
      const prefix = (body, count) => JSON.stringify({ system: body.system, tools: body.tools ?? [], messages: body.messages.slice(0, count) });
      const selected = new ai.AnthropicGateway({ apiKey: 'fake-test', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-fable-5-1' }, {
        async send(request) {
          const body = JSON.parse(request.body);
          assert.equal(request.headers['anthropic-beta'], 'thinking-binding-controls-2026-08-01');
          assert.equal(body.thinking.type, 'adaptive');
          assert.equal(body.thinking.block_binding.prefix_mismatch_behavior, 'drop_block');
          assert(!['tool', 'any'].includes(body.tool_choice?.type), 'always-thinking model must not receive forced tools');
          body.messages.forEach((message, index) => message.content.forEach(block => {
            if (block.type === 'thinking' && bindings.get(block.signature) !== prefix(body, index)) mismatches++;
          }));
          const next = responses[bodies.length];
          assert(next, 'unexpected extra request');
          bodies.push(body);
          const signature = `bound-${bodies.length}`;
          bindings.set(signature, prefix(body, body.messages.length));
          return Response.json({ content: [{ type: 'thinking', thinking: 'mock', signature }, ...next], stop_reason: next.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn', usage: { output_tokens: 12 } });
        }
      });
      const runtime = new Runtime({ async invoke(invocation, selected) { return selected.complete({ ...invocation, requestId: `test-${bodies.length}` }); } },
        allowPolicy(), { async execute(definition, invocation) { effects.push(invocation.name); return executor(definition, invocation); } }, { async save() {} });
      const promise = runtime.execute(command({ tools, preferStream: false, ...extras }), selected);
      return { promise, bodies, effects, mismatches: () => mismatches };
    }
    const fixed = await run([read], [[call('practice_read', 'read')], [answer]], () => ({ content: '{}', madeProgress: true }));
    assert.equal((await fixed.promise).status, 'completed');
    assert.equal(fixed.mismatches(), 0);
    const dynamic = await run([selector], [[call('skill_load', 'load')], [answer]], () => ({
      content: 'loaded', madeProgress: true, activateToolNames: [read.name], activateSkills: [{ ...skill, allowedTools: [read.name], validatorNames: [], requiresOperationalTool: false }]
    }), { availableTools: [selector, read] });
    assert.equal((await dynamic.promise).status, 'completed');
    assert(dynamic.mismatches() > 0, 'fixture must exercise a real system/tools prefix edit');
    assert.notEqual(dynamic.bodies[0].system, dynamic.bodies[1].system);
    assert.equal(dynamic.bodies[1].tools.length, 2);
    const finalization = await run([write, verify], [[call('practice_generate', 'write')], [call('task_verify', 'verify')], [answer]], (_, c) => c.name === write.name
      ? { content: 'queued', madeProgress: true, completionExpectation: { resourceType: 'agent_run', resourceId: 'task', expectedTerminalState: 'completed' } }
      : { content: 'complete', madeProgress: true, completionVerification: { resourceType: 'agent_run', resourceId: 'task', state: 'completed', terminal: true } }, { skills: [skill] });
    assert.equal((await finalization.promise).status, 'completed');
    assert(finalization.mismatches() > 0);
    assert.equal(finalization.bodies.length, 3);
    const forced = await run([scan], [[answer], [call('question_bank_scan', 'scan')], [answer]], () => ({ content: '{}', madeProgress: true }), { requiredToolName: scan.name });
    assert.equal((await forced.promise).status, 'completed');
    assert.deepEqual(forced.effects, [scan.name]);
    assert(forced.bodies.every(body => body.tool_choice?.type === 'auto'));
    const missing = await run([scan], [[answer], [answer], [answer]], () => assert.fail('unexpected tool'), { requiredToolName: scan.name });
    await assert.rejects(missing.promise, /必要的真实工具调用/);
    assert.deepEqual(missing.effects, [], 'auto downgrade must not count narration as actual tool use');
  }
}

async function verifiesFirstTurnStreaming(agent, pi, ai) {
  const events = [];
  let deltasSeenBeforeModelFinished = 0;
  const runtime = new pi.PiAgentLoopRuntime(
    {
      async invoke(invocation) {
        assert(invocation.tools.length > 0, 'chat turns always offer tools');
        for (const piece of ['今天先', '做一组', '判断推理。']) {
          await invocation.onDelta?.(piece);
          await waitFor(() => events.some((event) => event.type === 'text_delta' && event.text === piece));
          deltasSeenBeforeModelFinished += 1;
        }
        return { text: '今天先做一组判断推理。', usage: {} };
      }
    },
    allowPolicy(),
    { async execute() { return { content: '' }; } },
    { async save() {} },
    { onEvent(event) { events.push(event); } }
  );
  const result = await runtime.execute(command({ tools: [readTool('practice.read')] }), gateway(ai));
  assert.equal(result.text, '今天先做一组判断推理。');
  assert.equal(deltasSeenBeforeModelFinished, 3, 'first-turn text reaches observers delta by delta while the model is still writing');
  assert.deepEqual(
    events.filter((event) => event.type === 'text_delta').map((event) => event.text),
    ['今天先', '做一组', '判断推理。']
  );
  assert(
    events.findIndex((event) => event.type === 'text_delta') < events.findIndex((event) => event.type === 'run_completed'),
    'streamed text precedes completion'
  );
}

async function verifiesToolTurnTextIsProvisional(agent, pi, ai) {
  const events = [];
  const runtime = new pi.PiAgentLoopRuntime(
    sequenceInvoker([
      {
        text: '我先查一下你的练习记录。',
        toolCalls: [{ id: 'call:read', name: 'practice_read', arguments: {} }],
        usage: {}
      },
      { text: '## 今日建议\n先做判断推理。', usage: {} }
    ]),
    allowPolicy(),
    { async execute() { return { content: '{"count":1}', madeProgress: true }; } },
    { async save() {} },
    { onEvent(event) { events.push(event); } }
  );
  const result = await runtime.execute(command({ tools: [readTool('practice.read')] }), gateway(ai));
  assert.equal(result.text, '## 今日建议\n先做判断推理。', 'the loop result is the final turn only');
  const order = events
    .filter((event) => ['model_turn_started', 'text_delta', 'tool_call_requested'].includes(event.type))
    .map((event) => event.type === 'text_delta' ? `text:${event.text}` : event.type);
  assert.deepEqual(order, [
    'model_turn_started',
    'text:我先查一下你的练习记录。',
    'tool_call_requested',
    'model_turn_started',
    'text:## 今日建议\n先做判断推理。'
  ], 'observers see each turn boundary, so a preamble can be retired before the answer streams');

  const forcedEvents = [];
  const forced = new pi.PiAgentLoopRuntime(
    sequenceInvoker([
      {
        text: '我现在调用导入工具。',
        toolCalls: [{ id: 'call:scan', name: 'practice_read', arguments: {} }],
        usage: {}
      },
      { text: '已完成扫描。', usage: {} }
    ]),
    allowPolicy(),
    { async execute() { return { content: '{"ok":true}', madeProgress: true }; } },
    { async save() {} },
    { onEvent(event) { forcedEvents.push(event); } }
  );
  await forced.execute(command({
    tools: [readTool('practice.read')],
    requiredToolName: 'practice.read',
    forceRequiredToolOnFirstTurn: true
  }), gateway(ai));
  assert.deepEqual(
    forcedEvents.filter((event) => event.type === 'text_delta').map((event) => event.text),
    ['已完成扫描。'],
    'narration of a forced tool turn is never streamed'
  );
}

async function verifiesOutputLimitHandling(agent, pi, ai) {
  const executed = [];
  const runtime = new pi.PiAgentLoopRuntime(
    sequenceInvoker([
      {
        text: '',
        toolCalls: [{ id: 'call:cut', name: 'practice_read', arguments: { scope: 'to' } }],
        finishReason: 'max_tokens',
        usage: {}
      },
      { text: '今天先做判断推理，然后', finishReason: 'max_tokens', usage: {} }
    ]),
    allowPolicy(),
    { async execute(definition) { executed.push(definition.name); return { content: '{}', madeProgress: true }; } },
    { async save() {} }
  );
  const result = await runtime.execute(command({ tools: [readTool('practice.read')] }), gateway(ai));
  assert.deepEqual(executed, [], "Anthropic max_tokens maps to Pi's length stop, so truncated tool calls never run");
  assert.match(result.text, /^今天先做判断推理，然后/);
  assert.match(result.text, /已达长度上限/, 'a truncated final answer says it was cut off');
}

async function verifiesThinkingReplayThroughPi(pi, ai, server) {
  const bodies = [];
  const sse = (events) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  });
  const gateway = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-opus-5'
  }, {
    async send(request) {
      bodies.push(JSON.parse(request.body));
      if (bodies.length === 1) {
        return sse([
          { type: 'message_start', message: { id: 'turn-1' } },
          { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '需要先看练习库。' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-pi-1' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_pi', name: 'practice_read' } },
          { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"scope":"today"}' } },
          { type: 'content_block_stop', index: 1 },
          { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
          { type: 'message_stop' }
        ]);
      }
      return sse([
        { type: 'message_start', message: { id: 'turn-2' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '整理答复。' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-pi-2' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '今天有一套待练题组。' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
        { type: 'message_stop' }
      ]);
    }
  });
  const checkpoints = [];
  const events = [];
  const runtime = new pi.PiAgentLoopRuntime(
    {
      async invoke(invocation, selected, signal) {
        return selected.stream({ ...invocation, requestId: `pi-${bodies.length + 1}` }, (event) => invocation.onDelta?.(event.text), signal);
      }
    },
    allowPolicy(),
    { async execute() { return { content: '{"count":1}', madeProgress: true }; } },
    { async save(checkpoint) { checkpoints.push(checkpoint); } },
    { onEvent(event) { events.push(event); } }
  );
  const result = await runtime.execute(command({ tools: [readTool('practice.read')] }), gateway);
  assert.equal(result.text, '今天有一套待练题组。');
  assert.equal(bodies.length, 2);
  const replayed = bodies[1].messages.find((message) => message.role === 'assistant');
  assert.deepEqual(replayed.content.map((block) => block.type), ['thinking', 'tool_use'], 'the tool_use turn is replayed with its thinking first');
  assert.equal(replayed.content[0].thinking, '需要先看练习库。');
  assert.equal(replayed.content[0].signature, 'sig-pi-1', 'the thinking signature survives the Pi message adapter');
  assert.equal('temperature' in bodies[0], false, 'Pi turns send no sampling parameters to Claude 5');
  const checkpointAssistant = checkpoints.at(-1).messages.find((message) => message.toolCalls?.length);
  assert.deepEqual(checkpointAssistant.reasoning, [{ type: 'thinking', thinking: '需要先看练习库。', signature: 'sig-pi-1' }], 'checkpoints keep reasoning for confirmation resumes');
  assert.equal(
    events.some((event) => event.type === 'text_delta' && /需要先看|整理答复/.test(event.text)),
    false,
    'thinking never reaches the chat as text'
  );
  const adapter = await server.ssrLoadModule('/src/modules/agent/application/pi/PiAgentMessageAdapter.ts');
  const roundTrip = adapter.toModelMessages(adapter.toPiMessages([{
    role: ai.ModelMessageRole.Assistant,
    content: '',
    toolCalls: [{ id: 'toolu_x', name: 'practice_read', arguments: {} }],
    reasoning: [{ type: 'thinking', thinking: '', signature: 'sig-x' }, { type: 'redacted_thinking', data: 'opaque' }]
  }]));
  assert.deepEqual(roundTrip[0].reasoning, [
    { type: 'thinking', thinking: '', signature: 'sig-x' },
    { type: 'redacted_thinking', data: 'opaque' }
  ], 'checkpoint messages convert to Pi and back without touching reasoning');
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for streamed text');
    await delay(1);
  }
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
