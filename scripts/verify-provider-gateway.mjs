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
  const [ai, platformTransport] = await Promise.all([
    server.ssrLoadModule('/src/capabilities/ai-runtime/public.ts'),
    server.ssrLoadModule('/src/composition-root/ai/PlatformHttpTransport.ts')
  ]);
  assert.equal(ai.AI_EXECUTION_BUDGET.modelTurnMs, 180_000);
  assert.equal(ai.AI_EXECUTION_BUDGET.chatRunMs, 900_000);
  assert.equal(ai.generationExecutionBudgetMs(1), 45_600);
  assert.equal(ai.generationExecutionBudgetMs(5), 48_000);
  assert.equal(ai.generationExecutionBudgetMs(10), 51_000);
  assert.equal(ai.generationExecutionBudgetMs(25), 60_000);
  const parentDeadlineController = new AbortController();
  const parentDeadline = ai.createProviderExecutionDeadline(
    parentDeadlineController.signal,
    10_000,
    '用户取消测试'
  );
  parentDeadlineController.abort(new DOMException('user stopped', 'AbortError'));
  assert.equal(parentDeadline.signal.aborted, true);
  assert.equal(parentDeadline.signal.reason.name, 'AbortError');
  parentDeadline.dispose();

  const timeoutDeadline = ai.createProviderExecutionDeadline(undefined, 1_000, '模型调用测试');
  await new Promise((resolve) => timeoutDeadline.signal.addEventListener('abort', resolve, { once: true }));
  assert.equal(timeoutDeadline.signal.reason.kind, ai.ProviderErrorKind.Transient);
  assert.match(timeoutDeadline.signal.reason.message, /超时/);
  timeoutDeadline.dispose();
  assert.deepEqual(ai.parseStructuredJson('{"ok":true}'), { ok: true });
  assert.deepEqual(ai.parseStructuredJson('结果如下：\n```json\n{"ok":true,"text":"包含 } 字符"}\n```\n请查收。'), {
    ok: true,
    text: '包含 } 字符'
  });
  assert.deepEqual(ai.parseStructuredJson('已完成。\n[{"id":1},{"id":2}]\n以上。'), [{ id: 1 }, { id: 2 }]);
  assert.throws(() => ai.parseStructuredJson('没有结构化结果'), /does not contain valid JSON/);

  const openAI = ai.parseOpenAIResponse({
    id: 'request-openai',
    choices: [{ message: { content: [{ type: 'text', text: '{"ok":true}' }] }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 7 }
  });
  assert.equal(openAI.text, '{"ok":true}');
  assert.equal(openAI.finishReason, 'stop');
  assert.deepEqual(openAI.usage, { inputTokens: 12, outputTokens: 7 });
  const openAITool = ai.parseOpenAIResponse({
    id: 'request-openai-tool',
    choices: [{
      message: {
        tool_calls: [{
          type: 'function',
          function: {
            name: 'submit_structured_result',
            arguments: '{"ok":true}'
          }
        }]
      },
      finish_reason: 'tool_calls'
    }]
  });
  assert.deepEqual(JSON.parse(openAITool.text), { ok: true });
  const openAIAgentTool = ai.parseOpenAIResponse({
    id: 'request-openai-agent-tool',
    choices: [{
      message: {
        tool_calls: [{
          id: 'call-profile',
          type: 'function',
          function: {
            name: 'student.read_profile',
            arguments: '{"scope":"current"}'
          }
        }]
      },
      finish_reason: 'tool_calls'
    }]
  });
  assert.equal(openAIAgentTool.text, '');
  assert.deepEqual(openAIAgentTool.toolCalls, [{
    id: 'call-profile',
    name: 'student.read_profile',
    arguments: { scope: 'current' }
  }]);

  const anthropic = ai.parseAnthropicResponse({
    id: 'request-anthropic',
    content: [{ type: 'text', text: '{"ok":true}' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 13, output_tokens: 8 }
  });
  assert.equal(anthropic.text, '{"ok":true}');
  assert.equal(anthropic.finishReason, 'end_turn');
  assert.deepEqual(anthropic.usage, { inputTokens: 13, outputTokens: 8 });
  const anthropicTool = ai.parseAnthropicResponse({
    id: 'request-anthropic-tool',
    content: [{
      type: 'tool_use',
      id: 'tool-1',
      name: 'submit_structured_result',
      input: { lecture: { schemaVersion: 'content.v1', blocks: [] }, questions: [] }
    }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 20, output_tokens: 10 }
  });
  assert.deepEqual(JSON.parse(anthropicTool.text), {
    lecture: { schemaVersion: 'content.v1', blocks: [] },
    questions: []
  });
  const anthropicAgentTool = ai.parseAnthropicResponse({
    id: 'request-anthropic-agent-tool',
    content: [{
      type: 'tool_use',
      id: 'call-plan',
      name: 'planning.propose_daily_plan',
      input: { date: '2026-07-25' }
    }],
    stop_reason: 'tool_use'
  });
  assert.deepEqual(anthropicAgentTool.toolCalls, [{
    id: 'call-plan',
    name: 'planning.propose_daily_plan',
    arguments: { date: '2026-07-25' }
  }]);

  const openAIStream = new ai.OpenAIStreamAccumulator();
  assert.equal(openAIStream.append({
    id: 'stream-openai-tool',
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          id: 'call-stream-profile',
          type: 'function',
          function: { name: 'student.', arguments: '{"scope":' }
        }]
      }
    }]
  }), '');
  assert.equal(openAIStream.append({
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          function: { name: 'read_profile', arguments: '"current"}' }
        }]
      },
      finish_reason: 'tool_calls'
    }],
    usage: { prompt_tokens: 9, completion_tokens: 4 }
  }), '');
  assert.deepEqual(openAIStream.response(), {
    text: '',
    toolCalls: [{
      id: 'call-stream-profile',
      name: 'student.read_profile',
      arguments: { scope: 'current' }
    }],
    finishReason: 'tool_calls',
    providerRequestId: 'stream-openai-tool',
    usage: { inputTokens: 9, outputTokens: 4 }
  });

  const anthropicStream = new ai.AnthropicStreamAccumulator();
  anthropicStream.append({
    type: 'message_start',
    message: {
      id: 'stream-anthropic-tool',
      usage: { input_tokens: 11, output_tokens: 0 }
    }
  });
  anthropicStream.append({
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'tool_use',
      id: 'call-stream-plan',
      name: 'planning.propose_daily_plan'
    }
  });
  anthropicStream.append({
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: '{"date":"2026-' }
  });
  anthropicStream.append({
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: '07-25"}' }
  });
  anthropicStream.append({
    type: 'message_delta',
    delta: { stop_reason: 'tool_use' },
    usage: { output_tokens: 6 }
  });
  assert.deepEqual(anthropicStream.response(), {
    text: '',
    toolCalls: [{
      id: 'call-stream-plan',
      name: 'planning.propose_daily_plan',
      arguments: { date: '2026-07-25' }
    }],
    finishReason: 'tool_use',
    providerRequestId: 'stream-anthropic-tool',
    usage: { inputTokens: 11, outputTokens: 6 }
  });

  let anthropicRequest;
  const gateway = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://api.anthropic.test/v1',
    model: 'claude-test'
  }, {
    async send(request) {
      anthropicRequest = request;
      return new Response(JSON.stringify({
        id: 'request-tool-schema',
        content: [{
          type: 'tool_use',
          name: 'submit_structured_result',
          input: { ok: true }
        }],
        stop_reason: 'tool_use'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await gateway.complete({
    system: 'system',
    messages: [{ role: 'user', content: 'generate' }],
    temperature: 0.2,
    maxOutputTokens: 1000,
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    },
    requestId: 'request-id'
  });
  const anthropicBody = JSON.parse(anthropicRequest.body);
  assert.equal(anthropicBody.tools[0].name, 'submit_structured_result');
  assert.deepEqual(anthropicBody.tools[0].input_schema.required, ['ok']);
  assert.equal(anthropicBody.tool_choice.type, 'tool');
  assert.equal(anthropicBody.tool_choice.name, 'submit_structured_result');
  assert.equal('disable_parallel_tool_use' in anthropicBody.tool_choice, false);
  assert.equal(anthropicRequest.url, 'https://api.anthropic.test/v1/messages');
  let structuredStreamDelta = '';
  const structuredStreamResult = await gateway.stream({
    system: 'system',
    messages: [{ role: 'user', content: 'generate' }],
    temperature: 0.2,
    maxOutputTokens: 1000,
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    },
    requestId: 'request-id-stream'
  }, (event) => {
    structuredStreamDelta += event.text;
  });
  assert.equal(structuredStreamDelta, '{"ok":true}');
  assert.equal(structuredStreamResult.text, '{"ok":true}');

  const anthropicFallbackBodies = [];
  const anthropicFallbackGateway = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://anthropic-compatible.test/v1',
    model: 'compatible-model'
  }, {
    async send(request) {
      const body = JSON.parse(request.body);
      anthropicFallbackBodies.push(body);
      if (anthropicFallbackBodies.length === 1) {
        return new Response(JSON.stringify({
          error: { message: 'forced tool_choice is unavailable for this model' }
        }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        id: 'request-anthropic-fallback',
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const anthropicFallbackResult = await anthropicFallbackGateway.complete({
    system: 'system',
    messages: [{ role: 'user', content: 'generate' }],
    temperature: 0.2,
    maxOutputTokens: 1000,
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    },
    requestId: 'anthropic-fallback-request-id'
  });
  assert.equal(anthropicFallbackResult.text, '{"ok":true}');
  assert.equal(anthropicFallbackBodies.length, 2);
  assert.equal(anthropicFallbackBodies[0].tools[0].name, 'submit_structured_result');
  assert.equal('tools' in anthropicFallbackBodies[1], false);
  assert.match(anthropicFallbackBodies[1].system, /structured_output/);
  await anthropicFallbackGateway.complete({
    system: 'system',
    messages: [{ role: 'user', content: 'generate again' }],
    temperature: 0.2,
    maxOutputTokens: 1000,
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    },
    requestId: 'anthropic-fallback-request-id-2'
  });
  assert.equal(anthropicFallbackBodies.length, 3);
  assert.equal('tools' in anthropicFallbackBodies[2], false, 'unsupported structured tool mode must stay disabled');

  const sharedFallbackBodies = [];
  const sharedFallbackGateway = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://anthropic-compatible.test/v1',
    model: 'compatible-model'
  }, {
    async send(request) {
      sharedFallbackBodies.push(JSON.parse(request.body));
      return new Response(JSON.stringify({
        id: 'request-shared-prompt-capability',
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await sharedFallbackGateway.complete({
    system: 'system',
    messages: [{ role: 'user', content: 'reuse learned capability' }],
    temperature: 0.2,
    maxOutputTokens: 1000,
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    },
    requestId: 'anthropic-shared-fallback-request-id'
  });
  assert.equal(
    'tools' in sharedFallbackBodies[0],
    false,
    'new gateways for the same endpoint and model must reuse learned prompt mode'
  );

  const concurrentFallbackBodies = [];
  const concurrentFallbackGateway = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://concurrent-capability-probe.test/v1',
    model: 'concurrent-compatible-model'
  }, {
    async send(request) {
      const body = JSON.parse(request.body);
      concurrentFallbackBodies.push(body);
      if ('tools' in body) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify({
          error: { message: 'forced tool_choice is unavailable for this model' }
        }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({
        id: `request-concurrent-prompt-${concurrentFallbackBodies.length}`,
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const concurrentResults = await Promise.all(Array.from({ length: 6 }, (_, index) => (
    concurrentFallbackGateway.complete({
      system: 'system',
      messages: [{ role: 'user', content: `generate shard ${index + 1}` }],
      temperature: 0.2,
      maxOutputTokens: 1000,
      responseSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: { ok: { type: 'boolean' } }
      },
      requestId: `concurrent-fallback-request-${index + 1}`
    })
  )));
  assert.equal(concurrentResults.length, 6);
  assert.equal(
    concurrentFallbackBodies.filter((body) => 'tools' in body).length,
    1,
    'concurrent structured requests must share one capability probe'
  );
  assert.equal(
    concurrentFallbackBodies.filter((body) => !('tools' in body)).length,
    6,
    'all concurrent requests must use the learned prompt fallback without repeating tool mode'
  );

  const forcedPromptBodies = [];
  const forcedPromptGateway = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://forced-prompt-generation.test/v1',
    model: 'generation-model'
  }, {
    async send(request) {
      const body = JSON.parse(request.body);
      forcedPromptBodies.push(body);
      return new Response(JSON.stringify({
        id: `request-forced-prompt-${forcedPromptBodies.length}`,
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await Promise.all(Array.from({ length: 6 }, (_, index) => forcedPromptGateway.complete({
    system: 'system',
    messages: [{ role: 'user', content: `generate content shard ${index + 1}` }],
    temperature: 0.2,
    maxOutputTokens: 1000,
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    },
    structuredOutputMode: 'prompt',
    requestId: `forced-prompt-request-${index + 1}`
  })));
  assert.equal(forcedPromptBodies.length, 6);
  assert(
    forcedPromptBodies.every((body) => !('tools' in body)),
    'generation prompt mode must start all shards without a tool-capability probe'
  );
  assert(
    forcedPromptBodies.every((body) => String(body.system).includes('structured_output')),
    'generation prompt mode must retain the structured JSON contract'
  );

  const malformedToolBodies = [];
  const malformedToolGateway = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://malformed-anthropic-compatible.test/v1',
    model: 'compatible-model'
  }, {
    async send(request) {
      const body = JSON.parse(request.body);
      malformedToolBodies.push(body);
      if (malformedToolBodies.length === 1) {
        return new Response(JSON.stringify({
          id: 'request-empty-tool-input',
          content: [{
            type: 'tool_use',
            name: 'submit_structured_result',
            input: {}
          }],
          stop_reason: 'tool_use'
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        id: 'request-prompt-after-empty-tool-input',
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const malformedToolResult = await malformedToolGateway.complete({
    system: 'system',
    messages: [{ role: 'user', content: 'generate' }],
    temperature: 0.2,
    maxOutputTokens: 1000,
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    },
    requestId: 'malformed-tool-request-id'
  });
  assert.equal(malformedToolResult.text, '{"ok":true}');
  assert.equal(malformedToolBodies.length, 2);
  assert.equal(malformedToolBodies[0].tools[0].name, 'submit_structured_result');
  assert.equal('tools' in malformedToolBodies[1], false);
  await malformedToolGateway.complete({
    system: 'system',
    messages: [{ role: 'user', content: 'generate again' }],
    temperature: 0.2,
    maxOutputTokens: 1000,
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    },
    requestId: 'malformed-tool-request-id-2'
  });
  assert.equal(malformedToolBodies.length, 3);
  assert.equal(
    'tools' in malformedToolBodies[2],
    false,
    'malformed structured tool output must disable tool mode for the gateway lifetime'
  );

  const emptyStructuredBodies = [];
  const emptyStructuredGateway = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://empty-anthropic-compatible.test/v1',
    model: 'compatible-model'
  }, {
    async send(request) {
      const body = JSON.parse(request.body);
      emptyStructuredBodies.push(body);
      if (emptyStructuredBodies.length === 1) {
        return new Response(JSON.stringify({
          id: 'request-empty-structured-tool',
          content: [],
          stop_reason: 'end_turn'
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        id: 'request-prompt-after-empty-structured-tool',
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const emptyStructuredResult = await emptyStructuredGateway.complete({
    system: 'system',
    messages: [{ role: 'user', content: 'generate' }],
    temperature: 0.2,
    maxOutputTokens: 1000,
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    },
    requestId: 'empty-structured-request-id'
  });
  assert.equal(emptyStructuredResult.text, '{"ok":true}');
  assert.equal(emptyStructuredBodies.length, 2);
  assert.equal(emptyStructuredBodies[0].tools[0].name, 'submit_structured_result');
  assert.equal('tools' in emptyStructuredBodies[1], false);

  let deepSeekRequest;
  const deepSeekGateway = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-v4-falsh'
  }, {
    async send(request) {
      deepSeekRequest = request;
      return new Response(JSON.stringify({
        id: 'request-deepseek-tool-schema',
        content: [{
          type: 'tool_use',
          name: 'submit_structured_result',
          input: { ok: true }
        }],
        stop_reason: 'tool_use'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await deepSeekGateway.complete({
    system: 'system',
    messages: [{ role: 'user', content: 'generate' }],
    temperature: 0.2,
    maxOutputTokens: 1000,
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    },
    requestId: 'deepseek-request-id'
  });
  const deepSeekBody = JSON.parse(deepSeekRequest.body);
  assert.equal(deepSeekGateway.model, 'deepseek-v4-flash');
  assert.equal(deepSeekBody.model, 'deepseek-v4-flash');
  assert.equal(deepSeekRequest.url, 'https://api.deepseek.com/anthropic/messages');
  assert.equal(deepSeekBody.tools[0].name, 'submit_structured_result');
  assert.equal(deepSeekBody.tool_choice.type, 'tool');
  assert.equal(deepSeekBody.thinking.type, 'disabled');
  const deepSeekSchema = ai.anthropicInputSchema('https://api.deepseek.com/anthropic', {
    type: 'object',
    properties: { lecture: { $ref: '#/$defs/contentDocument' } },
    $defs: {
      contentDocument: {
        type: 'object',
        properties: { schemaVersion: { type: 'string', const: 'content.v1' } }
      }
    }
  });
  assert.equal('$ref' in deepSeekSchema.properties.lecture, false);
  assert.equal(deepSeekSchema.properties.lecture.properties.schemaVersion.const, 'content.v1');

  let deepSeekAgentRequest;
  const deepSeekAgentGateway = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-v4-flash'
  }, {
    async send(request) {
      deepSeekAgentRequest = request;
      return new Response(JSON.stringify({
        id: 'request-deepseek-agent-tool',
        content: [{ type: 'text', text: '完成' }],
        stop_reason: 'end_turn'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await deepSeekAgentGateway.complete({
    system: 'system',
    messages: [
      { role: ai.ModelMessageRole.User, content: '搜索真题' },
      {
        role: ai.ModelMessageRole.Assistant,
        content: '',
        toolCalls: [{ id: 'search-1', name: 'web.search', arguments: { query: '江苏省考真题' } }]
      },
      { role: ai.ModelMessageRole.Tool, toolCallId: 'search-1', content: '{"results":[]}' }
    ],
    temperature: 0.2,
    maxOutputTokens: 1000,
    tools: [{
      name: 'web.search',
      description: '搜索公开资料。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: { query: { $ref: '#/$defs/query' } },
        $defs: { query: { type: 'string', minLength: 2 } }
      }
    }],
    toolChoice: 'auto',
    requestId: 'deepseek-agent-request-id'
  });
  const deepSeekAgentBody = JSON.parse(deepSeekAgentRequest.body);
  assert.equal(deepSeekAgentBody.thinking.type, 'disabled');
  assert.equal('$ref' in deepSeekAgentBody.tools[0].input_schema.properties.query, false);
  assert.equal(deepSeekAgentBody.messages[1].content[0].type, 'tool_use');
  assert.equal(deepSeekAgentBody.messages[2].content[0].type, 'tool_result');

  let openAIRequest;
  const openAIGateway = new ai.OpenAICompatibleGateway({
    apiKey: 'test-key',
    baseUrl: 'https://openai-compatible.test/v1',
    model: 'claude-via-openai-protocol'
  }, {
    async send(request) {
      openAIRequest = request;
      return new Response(JSON.stringify({
        id: 'request-openai-structured',
        choices: [{
          message: {
            tool_calls: [{
              type: 'function',
              function: {
                name: 'submit_structured_result',
                arguments: '{"ok":true}'
              }
            }]
          },
          finish_reason: 'tool_calls'
        }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const openAIStructured = await openAIGateway.complete({
    system: 'system',
    messages: [{ role: 'user', content: 'generate' }],
    temperature: 0.2,
    maxOutputTokens: 1000,
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    },
    requestId: 'openai-request-id'
  });
  assert.equal(openAIStructured.text, '{"ok":true}');
  const openAIBody = JSON.parse(openAIRequest.body);
  assert.equal(openAIBody.tools[0].type, 'function');
  assert.equal(openAIBody.tools[0].function.name, 'submit_structured_result');
  assert.equal(openAIBody.tool_choice.function.name, 'submit_structured_result');
  assert.equal('response_format' in openAIBody, false);

  const fallbackBodies = [];
  const fallbackGateway = new ai.OpenAICompatibleGateway({
    apiKey: 'test-key',
    baseUrl: 'https://limited-compatible.test/v1/chat/completions',
    model: 'limited-model'
  }, {
    async send(request) {
      fallbackBodies.push(JSON.parse(request.body));
      if (fallbackBodies.length === 1) {
        return new Response(JSON.stringify({
          error: { message: 'tool_choice is unavailable for this model' }
        }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        id: 'request-fallback',
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const fallbackResult = await fallbackGateway.complete({
    system: 'system',
    messages: [{ role: 'user', content: 'generate' }],
    temperature: 0.2,
    maxOutputTokens: 1000,
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    },
    requestId: 'fallback-request-id'
  });
  assert.equal(fallbackResult.text, '{"ok":true}');
  assert.equal(fallbackBodies.length, 2);
  assert.equal('tools' in fallbackBodies[1], false);
  assert.match(fallbackBodies[1].messages[0].content, /structured_output/);
  await fallbackGateway.complete({
    system: 'system',
    messages: [{ role: 'user', content: 'generate again' }],
    temperature: 0.2,
    maxOutputTokens: 1000,
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    },
    requestId: 'fallback-request-id-2'
  });
  assert.equal(fallbackBodies.length, 3);
  assert.equal('tools' in fallbackBodies[2], false, 'unsupported structured tool mode must stay disabled');

  let openAIAgentRequest;
  const openAIAgentGateway = new ai.OpenAICompatibleGateway({
    apiKey: 'test-key',
    baseUrl: 'https://openai-compatible.test/v1',
    model: 'tool-model'
  }, {
    async send(request) {
      openAIAgentRequest = request;
      return new Response(JSON.stringify({
        id: 'request-agent-finished',
        choices: [{ message: { content: '完成' }, finish_reason: 'stop' }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await openAIAgentGateway.complete({
    system: 'system',
    messages: [
      { role: ai.ModelMessageRole.User, content: '读取档案' },
      {
        role: ai.ModelMessageRole.Assistant,
        content: '',
        toolCalls: [{ id: 'call-1', name: 'student.read_profile', arguments: {} }]
      },
      { role: ai.ModelMessageRole.Tool, toolCallId: 'call-1', content: '{"targetScore":80}' }
    ],
    temperature: 0.2,
    maxOutputTokens: 1000,
    tools: [{
      name: 'student.read_profile',
      description: '读取当前考生档案。',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} }
    }],
    toolChoice: 'auto',
    requestId: 'agent-openai-request'
  });
  const openAIAgentBody = JSON.parse(openAIAgentRequest.body);
  assert.equal(openAIAgentBody.messages[2].tool_calls[0].function.name, 'student.read_profile');
  assert.equal(openAIAgentBody.messages[3].tool_call_id, 'call-1');
  assert.equal(openAIAgentBody.tools[0].function.name, 'student.read_profile');

  let anthropicAgentRequest;
  const anthropicAgentGateway = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://api.anthropic.test/v1',
    model: 'claude-test'
  }, {
    async send(request) {
      anthropicAgentRequest = request;
      return new Response(JSON.stringify({
        id: 'request-agent-finished',
        content: [{ type: 'text', text: '完成' }],
        stop_reason: 'end_turn'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await anthropicAgentGateway.complete({
    system: 'system',
    messages: [
      { role: ai.ModelMessageRole.User, content: '读取档案' },
      {
        role: ai.ModelMessageRole.Assistant,
        content: '',
        toolCalls: [{ id: 'call-1', name: 'student.read_profile', arguments: {} }]
      },
      { role: ai.ModelMessageRole.Tool, toolCallId: 'call-1', content: '{"targetScore":80}' }
    ],
    temperature: 0.2,
    maxOutputTokens: 1000,
    tools: [{
      name: 'student.read_profile',
      description: '读取当前考生档案。',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} }
    }],
    toolChoice: 'auto',
    requestId: 'agent-anthropic-request'
  });
  const anthropicAgentBody = JSON.parse(anthropicAgentRequest.body);
  assert.equal(anthropicAgentBody.messages[1].content[0].type, 'tool_use');
  assert.equal(anthropicAgentBody.messages[2].content[0].type, 'tool_result');
  assert.equal(anthropicAgentBody.tools[0].name, 'student.read_profile');

  const adaptiveAnthropicBodies = [];
  const adaptiveAnthropicGateway = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://anthropic-compatible.test/v1',
    model: 'adaptive-model'
  }, {
    async send(request) {
      const body = JSON.parse(request.body);
      adaptiveAnthropicBodies.push(body);
      if (adaptiveAnthropicBodies.length === 1) {
        return new Response(JSON.stringify({
          error: { message: 'temperature is unavailable in thinking mode' }
        }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        id: 'adaptive-anthropic',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const adaptiveRequest = {
    system: 'system',
    messages: [{ role: ai.ModelMessageRole.User, content: 'hello' }],
    temperature: 0.2,
    maxOutputTokens: 100,
    requestId: 'adaptive-temperature'
  };
  await adaptiveAnthropicGateway.complete(adaptiveRequest);
  await adaptiveAnthropicGateway.complete({ ...adaptiveRequest, requestId: 'adaptive-temperature-2' });
  assert.equal(adaptiveAnthropicBodies[0].temperature, 0.2);
  assert.equal('temperature' in adaptiveAnthropicBodies[1], false);
  assert.equal(
    'temperature' in adaptiveAnthropicBodies[2],
    false,
    'an endpoint that rejected temperature must retain the learned capability'
  );

  const adaptiveThinkingBodies = [];
  const adaptiveThinkingGateway = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'adaptive-thinking-model'
  }, {
    async send(request) {
      const body = JSON.parse(request.body);
      adaptiveThinkingBodies.push(body);
      if (adaptiveThinkingBodies.length === 1) {
        return new Response(JSON.stringify({
          error: { message: 'thinking is not supported by this compatible endpoint' }
        }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        id: 'adaptive-thinking',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const adaptiveThinkingRequest = {
    ...adaptiveRequest,
    tools: [{
      name: 'student.read_profile',
      description: '读取当前考生档案。',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} }
    }],
    toolChoice: 'auto',
    requestId: 'adaptive-thinking'
  };
  await adaptiveThinkingGateway.complete(adaptiveThinkingRequest);
  await adaptiveThinkingGateway.complete({
    ...adaptiveThinkingRequest,
    requestId: 'adaptive-thinking-2'
  });
  assert.equal(adaptiveThinkingBodies[0].thinking.type, 'disabled');
  assert.equal('thinking' in adaptiveThinkingBodies[1], false);
  assert.equal(adaptiveThinkingBodies[1].temperature, 0.2);
  assert.equal(
    'thinking' in adaptiveThinkingBodies[2],
    false,
    'an endpoint that rejected thinking must retain the learned capability'
  );
  assert.equal(
    adaptiveThinkingBodies[2].temperature,
    0.2,
    'thinking fallback must not disable unrelated sampling parameters'
  );

  const adaptiveOpenAIBodies = [];
  const adaptiveOpenAIGateway = new ai.OpenAICompatibleGateway({
    apiKey: 'test-key',
    baseUrl: 'https://openai-compatible.test/v1',
    model: 'adaptive-model'
  }, {
    async send(request) {
      const body = JSON.parse(request.body);
      adaptiveOpenAIBodies.push(body);
      if (adaptiveOpenAIBodies.length === 1) {
        return new Response(JSON.stringify({
          error: { message: 'unsupported sampling parameter: temperature' }
        }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        id: 'adaptive-openai',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await adaptiveOpenAIGateway.complete(adaptiveRequest);
  assert.equal(adaptiveOpenAIBodies[0].temperature, 0.2);
  assert.equal('temperature' in adaptiveOpenAIBodies[1], false);

  await verifiesProviderFailureClassification(ai);
  await verifiesDeepSeekThinkingAndStreamIntegrity(ai);
  await verifiesClaudeSamplingAndThinkingReplay(ai);
  await verifiesBindingPolicyAndForcedTools(ai, server);
  verifiesResponseScopedToolIds(ai);
  await verifiesConnectionTestForThinkingModels(server);

  assert.equal(ai.openAITextDelta({ choices: [{ delta: { content: '甲' } }] }), '甲');
  assert.equal(ai.anthropicTextDelta({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: '乙' }
  }), '乙');
  assert.throws(() => ai.parseAnthropicResponse([]), /must be an object/);

  const abortController = new AbortController();
  const unresolved = new Promise(() => undefined);
  const abortable = platformTransport.settleWithAbort(unresolved, abortController.signal);
  abortController.abort(new DOMException('user stopped', 'AbortError'));
  await assert.rejects(abortable, /user stopped/);
  assert.equal(
    await platformTransport.settleWithAbort(Promise.resolve('completed')),
    'completed'
  );
  console.log('Provider gateway verification passed.');
} finally {
  await server.close();
}

async function verifiesProviderFailureClassification(ai) {
  const request = {
    system: 'system',
    messages: [{ role: ai.ModelMessageRole.User, content: '你好' }],
    temperature: 0.2,
    maxOutputTokens: 100,
    requestId: 'classification'
  };
  const json = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
  const html = (status) => new Response('<!DOCTYPE html><html><body>Not Found</body></html>', {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
  const cases = [
    ['401 invalid key', json(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }), ai.ProviderErrorKind.Authentication, 'provider.authentication'],
    ['401 OpenAI key', json(401, { error: { code: 'invalid_api_key', message: 'Incorrect API key provided' } }), ai.ProviderErrorKind.Authentication, 'provider.authentication'],
    ['402 balance', json(402, { error: { message: 'Insufficient Balance' } }), ai.ProviderErrorKind.QuotaExceeded, 'provider.quota_exceeded'],
    ['429 quota', json(429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }), ai.ProviderErrorKind.QuotaExceeded, 'provider.quota_exceeded'],
    ['429 TPM', json(429, { error: { code: 'rate_limit_exceeded', message: 'Rate limit reached on tokens per min (TPM)' } }), ai.ProviderErrorKind.RateLimited, 'provider.rate_limited'],
    ['404 model', json(404, { error: { code: 'model_not_found', message: 'The model `gpt-x` does not exist' } }), ai.ProviderErrorKind.InvalidRequest, 'provider.model_not_found'],
    ['400 model', json(400, { error: { type: 'invalid_request_error', message: 'Model Not Exist' } }), ai.ProviderErrorKind.InvalidRequest, 'provider.model_not_found'],
    ['404 html', html(404), ai.ProviderErrorKind.InvalidRequest, 'provider.endpoint_not_found'],
    ['400 context', json(400, { error: { message: "This model's maximum context length is 65536 tokens" } }), ai.ProviderErrorKind.InvalidRequest, 'provider.context_too_long'],
    ['400 generic', json(400, { error: { message: 'unexpected field foo' } }), ai.ProviderErrorKind.InvalidRequest, 'provider.invalid_request'],
    ['500', json(500, { error: { type: 'api_error', message: 'Internal server error' } }), ai.ProviderErrorKind.Transient, 'provider.transient'],
    ['529', json(529, { error: { type: 'overloaded_error', message: 'Overloaded' } }), ai.ProviderErrorKind.Transient, 'provider.overloaded'],
    ['200 html', html(200), ai.ProviderErrorKind.Protocol, 'provider.html_response']
  ];
  for (const [label, response, kind, code] of cases) {
    for (const Gateway of [ai.AnthropicGateway, ai.OpenAICompatibleGateway]) {
      const gateway = new Gateway({
        apiKey: 'test-key',
        baseUrl: 'https://classification.test/v1',
        model: 'classification-model'
      }, { async send() { return response.clone(); } });
      await assert.rejects(gateway.complete(request), (error) => {
        assert.equal(error.kind, kind, `${label} kind via ${Gateway.name}`);
        assert.equal(error.code, code, `${label} code via ${Gateway.name}`);
        return true;
      });
    }
  }
  const streamingHtml = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://classification.test/v1',
    model: 'classification-model'
  }, { async send() { return html(200); } });
  await assert.rejects(
    streamingHtml.stream(request, () => undefined),
    (error) => error.code === 'provider.html_response',
    'an HTML page answering a stream request is a Base URL problem, not an empty answer'
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try {
    await assert.rejects(
      new ai.FetchHttpTransport().send({ url: 'https://offline.test', method: 'POST', headers: {}, body: '{}' }),
      (error) => error.kind === ai.ProviderErrorKind.Transient && error.code === 'network.unavailable'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function sse(events, { done = false } = {}) {
  const body = [
    ...events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`),
    ...(done ? ['data: [DONE]\n\n'] : [])
  ].join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function verifiesDeepSeekThinkingAndStreamIntegrity(ai) {
  const toolHistory = [
    { role: ai.ModelMessageRole.User, content: '今天练什么' },
    { role: ai.ModelMessageRole.Assistant, content: '', toolCalls: [{ id: 'read-1', name: 'student_read_profile', arguments: {} }] },
    { role: ai.ModelMessageRole.Tool, toolCallId: 'read-1', content: '{"targetScore":80}' }
  ];
  const bodies = [];
  const deepSeek = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-v4-flash'
  }, {
    async send(request) {
      bodies.push(JSON.parse(request.body));
      return new Response(JSON.stringify({
        id: 'deepseek-final',
        content: [{ type: 'text', text: '今天先练判断推理。' }],
        stop_reason: 'end_turn'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await deepSeek.complete({
    system: 'system',
    messages: toolHistory,
    temperature: 0.2,
    maxOutputTokens: 1000,
    toolChoice: 'none',
    requestId: 'deepseek-finalization'
  });
  assert.equal('tools' in bodies[0], false, 'a finalization turn offers no tools');
  assert.equal(bodies[0].thinking?.type, 'disabled', 'a finalization turn that replays tool blocks keeps DeepSeek thinking off');
  await deepSeek.complete({
    system: 'system',
    messages: [{ role: ai.ModelMessageRole.User, content: '你好' }],
    temperature: 0.2,
    maxOutputTokens: 1000,
    requestId: 'deepseek-plain'
  });
  assert.equal('thinking' in bodies[1], false, 'plain requests keep the provider default');
  await deepSeek.complete({
    system: 'system',
    messages: [{ role: ai.ModelMessageRole.User, content: '你好' }],
    temperature: 0,
    maxOutputTokens: 1024,
    thinking: 'disabled',
    requestId: 'deepseek-direct'
  });
  assert.equal(bodies[2].thinking?.type, 'disabled', 'callers can ask a thinking-by-default endpoint to answer directly');

  // "must be passed back" proves thinking is on; it must not be learned as unsupported.
  const replayBodies = [];
  const replayGateway = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-v4-flash'
  }, {
    async send(request) {
      replayBodies.push(JSON.parse(request.body));
      return new Response(JSON.stringify({
        error: { type: 'invalid_request_error', message: 'The `content[].thinking` in the thinking mode must be passed back to the API.' }
      }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
  });
  const toolRequest = {
    system: 'system',
    messages: toolHistory,
    temperature: 0.2,
    maxOutputTokens: 1000,
    tools: [{ name: 'student_read_profile', description: '读取档案。', inputSchema: { type: 'object', properties: {} } }],
    toolChoice: 'auto',
    requestId: 'thinking-replay'
  };
  await assert.rejects(replayGateway.complete(toolRequest), (error) => error.kind === ai.ProviderErrorKind.InvalidRequest);
  await assert.rejects(replayGateway.complete({ ...toolRequest, requestId: 'thinking-replay-2' }));
  assert.equal(replayBodies.length, 2, 'a thinking-replay rejection is not retried as if thinking were unsupported');
  assert.equal(replayBodies[1].thinking?.type, 'disabled', 'the disable flag survives a thinking-replay rejection');

  // Thinking-only or max_tokens-without-text answers are a clear, non-retryable error.
  let thinkingOnlyCalls = 0;
  const thinkingOnly = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-v4-flash'
  }, {
    async send(request) {
      thinkingOnlyCalls += 1;
      if (JSON.parse(request.body).stream) {
        return sse([
          { type: 'message_start', message: { id: 'thinking-stream', usage: { input_tokens: 9, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '用户想要……' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 64 } },
          { type: 'message_stop' }
        ]);
      }
      return new Response(JSON.stringify({
        id: 'thinking-only',
        content: [{ type: 'thinking', thinking: '用户想要……' }],
        stop_reason: 'max_tokens'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const shortRequest = {
    system: 'system',
    messages: [{ role: ai.ModelMessageRole.User, content: '你好' }],
    temperature: 0,
    maxOutputTokens: 64,
    requestId: 'thinking-only'
  };
  for (const attempt of [() => thinkingOnly.complete(shortRequest), () => thinkingOnly.stream(shortRequest, () => undefined)]) {
    await assert.rejects(attempt(), (error) => {
      assert.equal(error.kind, ai.ProviderErrorKind.OutputLimit);
      assert.equal(error.code, 'provider.thinking_only');
      assert.match(error.message, /思考/);
      return true;
    });
  }
  assert.equal(thinkingOnlyCalls, 2, 'each thinking-only answer costs exactly one provider call');

  const streamCase = (events, options) => new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://anthropic.stream.test/v1',
    model: 'stream-model'
  }, { async send() { return sse(events, options); } });
  const truncatedDeltas = [];
  await assert.rejects(
    streamCase([
      { type: 'message_start', message: { id: 'truncated' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '回答写到一半' } }
    ]).stream(shortRequest, (event) => { truncatedDeltas.push(event.text); }),
    (error) => error.kind === ai.ProviderErrorKind.Transient && error.code === 'provider.stream_interrupted',
    'a stream that ends without message_stop is an error, not a short success'
  );
  assert.deepEqual(truncatedDeltas, ['回答写到一半']);
  await assert.rejects(
    streamCase([
      { type: 'message_start', message: { id: 'overloaded' } },
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }
    ]).stream(shortRequest, () => undefined),
    (error) => error.code === 'provider.overloaded',
    'a mid-stream error event surfaces as that provider error'
  );
  const completed = await streamCase([
    { type: 'message_start', message: { id: 'complete' } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '完整回答' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' }
  ]).stream(shortRequest, () => undefined);
  assert.equal(completed.text, '完整回答');

  const openAIStream = (events, options) => new ai.OpenAICompatibleGateway({
    apiKey: 'test-key',
    baseUrl: 'https://openai.stream.test/v1',
    model: 'stream-model'
  }, { async send() { return sse(events, options); } });
  await assert.rejects(
    openAIStream([{ id: 'cut', choices: [{ delta: { content: '写到一半' } }] }]).stream(shortRequest, () => undefined),
    (error) => error.code === 'provider.stream_interrupted',
    'an OpenAI stream without [DONE] or finish_reason is an error'
  );
  await assert.rejects(
    openAIStream([
      { id: 'err', choices: [{ delta: { content: '先' } }] },
      { error: { code: 'rate_limit_exceeded', message: 'Rate limit reached' } }
    ]).stream(shortRequest, () => undefined),
    (error) => error.kind === ai.ProviderErrorKind.RateLimited,
    'an OpenAI error object inside the stream surfaces as that provider error'
  );
  await assert.rejects(
    openAIStream([
      { id: 'reasoning', choices: [{ delta: { reasoning_content: '思考……' } }] },
      { id: 'reasoning', choices: [{ delta: {}, finish_reason: 'length' }] }
    ], { done: true }).stream(shortRequest, () => undefined),
    (error) => error.kind === ai.ProviderErrorKind.OutputLimit && error.code === 'provider.thinking_only'
  );
  const openAIComplete = await openAIStream([
    { id: 'ok', choices: [{ delta: { content: '完整' } }] },
    { id: 'ok', choices: [{ delta: {}, finish_reason: 'stop' }] }
  ], { done: true }).stream(shortRequest, () => undefined);
  assert.equal(openAIComplete.text, '完整');
  assert.equal(ai.isOutputLengthFinish('max_tokens'), true);
  assert.equal(ai.isOutputLengthFinish('length'), true);
  assert.equal(ai.isOutputLengthFinish('end_turn'), false);
}

async function verifiesConnectionTestForThinkingModels(server) {
  const settings = new Map([[
    'zhangl-setting:secure-fallback:zhangl-ai-config',
    JSON.stringify({
      provider: 'anthropic',
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-v4-flash',
      maxConcurrentTasks: 1
    })
  ]]);
  const originalFetch = globalThis.fetch;
  // Swap descriptors instead of reading Node's own localStorage accessor, which warns.
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalWindow = globalThis.window;
  const requests = [];
  let thinkingOnly = false;
  globalThis.window = globalThis;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key) => settings.get(key) ?? null,
      setItem: (key, value) => { settings.set(key, value); },
      removeItem: (key) => { settings.delete(key); }
    }
  });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (thinkingOnly) {
      return new Response(JSON.stringify({ id: 't', content: [{ type: 'thinking', thinking: '……' }], stop_reason: 'max_tokens' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify(body.tools
      ? { id: 's', content: [{ type: 'tool_use', name: 'submit_structured_result', input: { ok: true } }], stop_reason: 'tool_use' }
      : { id: 'c', content: [{ type: 'text', text: '连接正常' }], stop_reason: 'end_turn' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const { configuredAIClient } = await server.ssrLoadModule('/src/composition-root/ai/ConfiguredAIClient.ts');
    assert.equal(await configuredAIClient.testConnection(), '连接正常');
    await configuredAIClient.testStructuredOutput();
    assert(requests.every((body) => body.thinking?.type === 'disabled'), 'connection tests ask DeepSeek to answer without thinking');
    assert(requests.every((body) => body.max_tokens >= 512), 'connection tests leave room for models that think anyway');
    thinkingOnly = true;
    await assert.rejects(configuredAIClient.testConnection(), (error) => {
      assert.match(error.message, /[一-鿿]/, 'the settings sheet shows a Chinese explanation');
      assert.doesNotMatch(error.message, /provider returned|empty content/i);
      return true;
    });
    thinkingOnly = false;
    requests.length = 0;
    settings.set('zhangl-setting:secure-fallback:zhangl-ai-config', JSON.stringify({
      provider: 'anthropic',
      apiKey: 'test-key',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-opus-5',
      maxConcurrentTasks: 1
    }));
    assert.equal(await configuredAIClient.testConnection(), '连接正常');
    assert.equal('temperature' in requests[0], false, 'the connection test sends no sampling parameters to Claude 5');
    assert.equal('thinking' in requests[0], false, 'the connection test does not try to disable Claude thinking');
    settings.delete('zhangl-setting:secure-fallback:zhangl-ai-config');
    await assert.rejects(configuredAIClient.testConnection(), /还没有配置 AI 模型/);
  } finally {
    globalThis.fetch = originalFetch;
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
    globalThis.window = originalWindow;
  }
}

async function verifiesClaudeSamplingAndThinkingReplay(ai) {
  const request = {
    system: 'system',
    messages: [{ role: ai.ModelMessageRole.User, content: '你好' }],
    temperature: 0,
    maxOutputTokens: 256,
    requestId: 'sampling'
  };
  const bodyFor = async (Gateway, model, baseUrl = 'https://api.anthropic.com/v1') => {
    let body;
    const gateway = new Gateway({ apiKey: 'test-key', baseUrl, model }, {
      async send(sent) {
        body = JSON.parse(sent.body);
        return new Response(JSON.stringify(Gateway === ai.AnthropicGateway
          ? { id: 'ok', content: [{ type: 'text', text: '连接正常' }], stop_reason: 'end_turn' }
          : { id: 'ok', choices: [{ message: { content: '连接正常' }, finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    });
    await gateway.complete(request);
    return body;
  };
  for (const model of ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-4-7', 'claude-opus-4-8', 'us.anthropic.claude-sonnet-5-v1:0']) {
    const body = await bodyFor(ai.AnthropicGateway, model);
    assert.equal('temperature' in body, false, `${model} rejects sampling parameters, so none are sent`);
    assert.equal('top_p' in body || 'top_k' in body, false);
    if (['claude-fable-5-1', 'claude-opus-5-5'].includes(model)) {
      assert.equal(body.thinking.type, 'adaptive');
      assert.equal(body.thinking.block_binding.prefix_mismatch_behavior, 'drop_block');
    } else assert.equal('thinking' in body, false, `${model} keeps its default thinking`);
  }
  assert.equal('temperature' in await bodyFor(ai.OpenAICompatibleGateway, 'claude-opus-5', 'https://proxy.test/v1'), false);
  assert.equal((await bodyFor(ai.AnthropicGateway, 'claude-opus-4-5')).temperature, 0, 'older models keep temperature');
  const alwaysThinking = await bodyFor(ai.AnthropicGateway, 'claude-opus-5-5', 'https://api.deepseek.com/anthropic');
  assert.equal('thinking' in alwaysThinking, false, 'a model that cannot disable thinking never receives {type:"disabled"}');

  // A streamed tool_use turn with thinking round-trips its blocks, signature included.
  const bodies = [];
  const gateway = new ai.AnthropicGateway({
    apiKey: 'test-key',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-opus-5'
  }, {
    async send(sent) {
      bodies.push(JSON.parse(sent.body));
      if (bodies.length === 1) {
        return sse([
          { type: 'message_start', message: { id: 'thinking-tool', usage: { input_tokens: 20, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先读取档案，' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '再安排。' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-abc123' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'opaque-payload' } },
          { type: 'content_block_stop', index: 1 },
          { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'student_read_profile' } },
          { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{}' } },
          { type: 'content_block_stop', index: 2 },
          { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } },
          { type: 'message_stop' }
        ]);
      }
      return sse([
        { type: 'message_start', message: { id: 'after-tool' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '今天先练判断推理。' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
        { type: 'message_stop' }
      ]);
    }
  });
  const tools = [{ name: 'student_read_profile', description: '读取档案。', inputSchema: { type: 'object', properties: {} } }];
  const first = await gateway.stream({ ...request, tools, toolChoice: 'auto', requestId: 'thinking-tool-1' }, () => undefined);
  assert.deepEqual(first.reasoning, [
    { type: 'thinking', thinking: '先读取档案，再安排。', signature: 'sig-abc123', budgetTokens: 30 },
    { type: 'redacted_thinking', data: 'opaque-payload' }
  ], 'thinking_delta and signature_delta accumulate into the reasoning blocks');
  assert.equal(first.text, '', 'reasoning never becomes visible text');
  await gateway.stream({
    ...request,
    tools,
    toolChoice: 'auto',
    requestId: 'thinking-tool-2',
    messages: [
      { role: ai.ModelMessageRole.User, content: '今天练什么' },
      { role: ai.ModelMessageRole.Assistant, content: first.text, toolCalls: first.toolCalls, reasoning: first.reasoning },
      { role: ai.ModelMessageRole.Tool, toolCallId: 'toolu_1', content: '{"targetScore":80}' }
    ]
  }, () => undefined);
  assert.deepEqual(bodies[1].messages[1].content, [
    { type: 'thinking', thinking: '先读取档案，再安排。', signature: 'sig-abc123' },
    { type: 'redacted_thinking', data: 'opaque-payload' },
    { type: 'tool_use', id: 'toolu_1', name: 'student_read_profile', input: {} }
  ], 'thinking blocks are replayed unchanged ahead of the tool_use they preceded');
  const parsed = ai.parseAnthropicResponse({
    id: 'non-stream',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig-empty' },
      { type: 'tool_use', id: 'toolu_2', name: 'student_read_profile', input: {} }
    ],
    stop_reason: 'tool_use'
  });
  assert.deepEqual(parsed.reasoning, [{ type: 'thinking', thinking: '', signature: 'sig-empty' }], 'empty thinking text is kept');

  // DeepSeek tool chains disable thinking, so no thinking block is replayed there.
  let deepSeekBody;
  await new ai.AnthropicGateway({ apiKey: 'test-key', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-v4-flash' }, {
    async send(sent) {
      deepSeekBody = JSON.parse(sent.body);
      return new Response(JSON.stringify({ id: 'ds', content: [{ type: 'text', text: '好' }], stop_reason: 'end_turn' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  }).complete({
    ...request,
    messages: [
      { role: ai.ModelMessageRole.User, content: '今天练什么' },
      { role: ai.ModelMessageRole.Assistant, content: '', toolCalls: first.toolCalls, reasoning: first.reasoning },
      { role: ai.ModelMessageRole.Tool, toolCallId: 'toolu_1', content: '{}' }
    ]
  });
  assert.equal(deepSeekBody.thinking.type, 'disabled');
  assert.deepEqual(deepSeekBody.messages[1].content.map((block) => block.type), ['tool_use']);
}

async function verifiesBindingPolicyAndForcedTools(ai, server) {
  const { compactAgentLoopMessages, sanitizeMessageForCheckpoint } = await server.ssrLoadModule('/src/modules/agent/application/AgentLoopSupport.ts');
  const base = { system: 'fixed', messages: [{ role: 'user', content: 'start' }], temperature: 0, maxOutputTokens: 512, requestId: 'binding' };
  const tool = { name: 'scan', description: 'scan', inputSchema: { type: 'object', properties: {} } };
  const thinking = [{ type: 'thinking', thinking: 'summary', signature: 'sig', budgetTokens: 80 }, { type: 'redacted_thinking', data: 'opaque' }];
  const history = [base.messages[0], { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'scan', arguments: {} }], reasoning: thinking }, { role: 'tool', toolCallId: 'call', content: 'ok' }];
  for (const model of ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5']) {
    const requests = [];
    const transport = { async send(request) {
      requests.push({ body: JSON.parse(request.body), headers: request.headers });
      return JSON.parse(request.body).stream
        ? sse([{ type: 'message_start', message: {} }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } }, { type: 'message_stop' }])
        : Response.json({ content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn' });
    } };
    const config = { apiKey: 'test', baseUrl: 'https://api.anthropic.com/v1', model };
    let selected = new ai.AnthropicGateway(config, transport);
    assert.equal(selected.capabilities.forcedToolChoice, false);
    await selected.complete({ ...base, tools: [tool] });
    await selected.complete({ ...base, system: 'new skill', tools: [tool, { ...tool, name: 'read' }], messages: history });
    await selected.stream({ ...base, messages: history }, () => undefined);
    // Restart must reconstruct the same binding policy, even if the checkpoint
    // dropped an image or context compaction rewrote messages before the signature.
    selected = new ai.AnthropicGateway(config, transport);
    const imageHistory = [{ role: 'user', content: [{ type: 'image', mediaType: 'image/png', dataBase64: 'private-image' }] }, ...history.slice(1)];
    const restored = JSON.parse(JSON.stringify(imageHistory.map(sanitizeMessageForCheckpoint)));
    assert(!JSON.stringify(restored).includes('private-image'));
    await selected.complete({ ...base, messages: restored });
    const compacted = compactAgentLoopMessages([...Array.from({ length: 16 }, () => ({ role: 'user', content: 'old '.repeat(500) })), ...history], 900);
    assert.match(compacted[0].content, /系统压缩/);
    await selected.complete({ ...base, messages: compacted });
    for (const choice of ['required', { name: 'scan' }, 'none']) {
      await selected.complete({ ...base, messages: history, tools: [tool], toolChoice: choice });
      assert.equal(requests.at(-1).body.tool_choice.type, choice === 'none' ? 'none' : 'auto');
    }
    await selected.prepareStructuredOutput();
    const count = requests.length;
    await selected.complete({ ...base, responseSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } });
    assert.equal(requests.length, count + 1, 'known unsupported forcing needs no rejected probe');
    assert.equal(requests.at(-1).body.tools, undefined);
    for (const { body, headers } of requests) {
      assert.equal(headers['anthropic-beta'], 'thinking-binding-controls-2026-08-01');
      assert.deepEqual(body.thinking, { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
      assert(!JSON.stringify(body).includes('budgetTokens'), 'internal budget is never sent to Anthropic');
    }
    assert.equal(requests[1].body.messages[1].content[0].signature, 'sig');
    assert.equal(requests[1].body.messages[1].content[1].data, 'opaque');
  }
  for (const [baseUrl, optIn] of [['https://proxy.test/v1', undefined], ['https://api.anthropic.com.evil.test/v1', undefined], ['http://api.anthropic.com/v1', undefined], ['https://proxy.test/v1', true], ['https://api.anthropic.com/v1', false]]) {
    const requests = [];
    const config = { apiKey: 'test', baseUrl, model: 'claude-fable-5-1', thinkingBindingControls: optIn };
    for (let turn = 0; turn < 2; turn++) {
      await new ai.AnthropicGateway(config, { async send(request) {
        requests.push({ body: JSON.parse(request.body), headers: request.headers });
        return Response.json({ content: [{ type: 'text', text: 'done' }] });
      } }).complete({ ...base, messages: history });
    }
    requests.forEach(({ body, headers }) => {
      assert.equal(Boolean(headers['anthropic-beta']), optIn === true);
      const blocks = body.messages[1].content;
      assert.equal(blocks.some(b => b.type === 'thinking' || b.type === 'redacted_thinking'), optIn === true);
      assert.equal(blocks.at(-1).id, 'call', 'stripping thinking preserves tool identity');
    });
  }
  // The OpenAI wire protocol can also front the same always-thinking model.
  let body;
  const selected = new ai.OpenAICompatibleGateway({ apiKey: 'test', baseUrl: 'https://proxy.test/v1', model: 'claude-fable-5-1' }, {
    async send(request) { body = JSON.parse(request.body); return Response.json({ choices: [{ message: { content: 'done' } }] }); }
  });
  await selected.complete({ ...base, tools: [tool], toolChoice: { name: 'scan' } });
  assert.equal(body.tool_choice, 'auto');
  for (const model of ['claude-mythos-5-1', 'claude-opus-4-5', 'claude-fable-5', 'claude-mythos-5']) {
    const selected = new ai.AnthropicGateway({ apiKey: 'test', baseUrl: 'https://api.anthropic.com/v1', model }, {
      async send(request) { body = JSON.parse(request.body); return Response.json({ content: [{ type: 'text', text: 'done' }] }); }
    });
    await selected.complete({ ...base, tools: [tool], toolChoice: 'required' });
    assert.equal(body.tool_choice.type, model === 'claude-mythos-5-1' ? 'auto' : 'any', 'force restrictions stay scoped to documented models');
  }
  let rejectedCalls = 0;
  const rejecting = new ai.AnthropicGateway({ apiKey: 'test', baseUrl: 'https://proxy.test/v1', model: 'claude-fable-5-1', thinkingBindingControls: true }, {
    async send(request) {
      rejectedCalls++;
      assert.equal(JSON.parse(request.body).thinking.block_binding.prefix_mismatch_behavior, 'drop_block');
      return Response.json({ error: { message: 'thinking.block_binding: Extra inputs are not permitted' } }, { status: 400 });
    }
  });
  for (let turn = 0; turn < 2; turn++) await assert.rejects(rejecting.complete(base), error => error.kind === ai.ProviderErrorKind.InvalidRequest);
  assert.equal(rejectedCalls, 2, 'a rejected binding policy is never silently disabled or retried with unsafe signature replay');
}

function verifiesResponseScopedToolIds(ai) {
  const parse = {
    openai: (value, id) => ai.parseOpenAIResponse({ id: 'reused-response-id', choices: [{ message: { tool_calls: [{ id, type: 'function', function: { name: 'change', arguments: JSON.stringify({ value }) } }] } }] }),
    anthropic: (value, id) => ai.parseAnthropicResponse({ content: [{ type: 'tool_use', id, name: 'change', input: { value } }] }),
    'openai-stream': (value, id) => {
      const stream = new ai.OpenAIStreamAccumulator();
      stream.append({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name: 'change', arguments: '{"value":' } }] } }] });
      const partialId = stream.response().toolCalls[0].id;
      stream.append({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: `${value}}` } }] }, finish_reason: 'tool_calls' }] });
      assert.equal(stream.response().toolCalls[0].id, partialId);
      assert.deepEqual(stream.response(), stream.response(), 'stream snapshots retain allocated identity');
      return stream.response();
    },
    'anthropic-stream': (value, id) => {
      const stream = new ai.AnthropicStreamAccumulator();
      stream.append({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: 'change' } });
      stream.append({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ value }) } });
      assert.deepEqual(stream.response(), stream.response());
      return stream.response();
    }
  };
  for (const [mode, response] of Object.entries(parse)) {
    const first = response(85).toolCalls[0], second = response(90).toolCalls[0];
    assert.notEqual(first.id, second.id, `${mode} allocates an identity unique to each response, even without response IDs`);
    assert.equal(response(90, 'provider-id').toolCalls[0].id, 'provider-id');
    assert.equal(JSON.parse(JSON.stringify(first)).id, first.id, 'checkpoint replay does not allocate a new identity');
  }
}
