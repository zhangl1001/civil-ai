import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
  const runtime = await server.ssrLoadModule('/src/capabilities/ai-runtime/public.ts');
  const registry = new runtime.PromptRegistry();
  const { contentHash, ...hashPayload } = runtime.weakeningQuestionPromptV1;
  const expectedHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(hashPayload)).digest('hex')}`;
  assert.equal(contentHash, expectedHash, `prompt content hash mismatch; expected ${expectedHash}`);
  registry.register(runtime.weakeningQuestionPromptV1);
  const compiler = new runtime.PromptCompiler(registry);
  const compiled = compiler.compile(
    runtime.weakeningQuestionPromptV1.promptCode,
    {
      QUESTION_COUNT: 5,
      ASSESSMENT_ROLE: 'practice',
      DIFFICULTY_MIN: 0.35,
      DIFFICULTY_MAX: 0.65
    },
    {
      capabilityNodeId: 'capability:aptitude:judgment:weaken',
      evidence: { confidence: 'insufficient' }
    }
  );
  assert(compiled.system.startsWith('# 第1章 命题身份与边界'));
  assert(compiled.system.includes('# 第6章 提交前质检'));
  assert(compiled.system.includes('本次生成 5 道题'));
  assert(!compiled.system.includes('{{QUESTION_COUNT}}'));
  assert.equal(compiled.version, '1.1.0');
  assert.equal(compiled.responseSchema.type, 'object');
  assert.throws(() => compiler.compile(
    runtime.weakeningQuestionPromptV1.promptCode,
    { QUESTION_COUNT: 5 },
    {}
  ), /missing variables/);
  assert.throws(() => registry.register({
    ...runtime.weakeningQuestionPromptV1,
    contentHash: 'sha256:different-content'
  }), /different content/);
  console.log('Prompt compiler verification passed.');
} finally {
  await server.close();
}
