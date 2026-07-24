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
  const ai = await server.ssrLoadModule('/src/capabilities/ai-runtime/public.ts');
  const openAI = ai.parseOpenAIResponse({
    id: 'request-openai',
    choices: [{ message: { content: [{ type: 'text', text: '{"ok":true}' }] }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 7 }
  });
  assert.equal(openAI.text, '{"ok":true}');
  assert.equal(openAI.finishReason, 'stop');
  assert.deepEqual(openAI.usage, { inputTokens: 12, outputTokens: 7 });

  const anthropic = ai.parseAnthropicResponse({
    id: 'request-anthropic',
    content: [{ type: 'text', text: '{"ok":true}' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 13, output_tokens: 8 }
  });
  assert.equal(anthropic.text, '{"ok":true}');
  assert.equal(anthropic.finishReason, 'end_turn');
  assert.deepEqual(anthropic.usage, { inputTokens: 13, outputTokens: 8 });
  assert.equal(ai.openAITextDelta({ choices: [{ delta: { content: '甲' } }] }), '甲');
  assert.equal(ai.anthropicTextDelta({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: '乙' }
  }), '乙');
  assert.throws(() => ai.parseAnthropicResponse([]), /must be an object/);
  console.log('Provider gateway verification passed.');
} finally {
  await server.close();
}
