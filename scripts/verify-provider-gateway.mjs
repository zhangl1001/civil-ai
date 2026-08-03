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
