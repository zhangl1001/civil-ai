import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

try {
  const { buildChatContext, buildConversationSummary, sanitizeContextMessage } = await server.ssrLoadModule('/src/ai/ChatContextBuilder.ts');
  assert.equal(sanitizeContextMessage('回复失败：network'), '');
  assert.equal(sanitizeContextMessage('先回答\n\n[[ZH_AI_STOPPED]]'), '先回答');
  assert.equal(sanitizeContextMessage('  '), '');

  const history = [
    message('m1', 'user', '你好'),
    message('m2', 'assistant', '我会陪你按目标复习。'),
    message('m3', 'tool', '工具执行中：生成练习'),
    message('m4', 'assistant', '回复失败：provider.empty_response'),
    message('m5', 'assistant', '上一轮有效建议'),
    message('m6', 'user', '今天怎么安排')
  ];
  const context = buildChatContext(history, { currentPrompt: '今天怎么安排', budget: 80, maxMessages: 8 });
  assert.deepEqual(context.map((item) => item.content), ['你好', '我会陪你按目标复习。', '上一轮有效建议']);
  assert.equal(context.some((item) => item.content.includes('工具执行中')), false);
  assert.equal(context.some((item) => item.content.includes('回复失败')), false);
  assert.equal(context.some((item) => item.content === '今天怎么安排'), false);

  const long = 'a'.repeat(4200);
  const clipped = sanitizeContextMessage(long);
  assert.equal(clipped.startsWith('a'.repeat(100)), true);
  assert.equal(clipped.includes('较长回复截断摘要'), true);
  assert.equal(clipped.length < long.length, true);

  const summary = buildConversationSummary(history);
  assert.equal(summary.includes('用户近期关注'), true);
  assert.equal(summary.includes('工具执行中'), false);
  assert.equal(summary.includes('回复失败'), false);

  console.log('Chat context verification passed.');
} finally {
  await server.close();
}

function message(id, role, content) {
  return { id, sessionId: 's1', role, content, createdAt: Date.now() };
}
