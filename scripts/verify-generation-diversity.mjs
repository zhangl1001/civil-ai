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
  const content = await server.ssrLoadModule('/src/modules/content/public.ts');
  const recentItems = [{
    title: '削弱论证基础',
    content: [
      '## 核心概念',
      '削弱论证需要先识别论点与论据。',
      '## 常见陷阱',
      '无关项不能削弱论证。'
    ].join('\n')
  }];
  const first = content.buildGenerationVariationContext({
    kind: content.GenerationVariationKind.DailyKnowledge,
    seed: 'AgentRunId:test',
    recentItems
  });
  const retry = content.buildGenerationVariationContext({
    kind: content.GenerationVariationKind.DailyKnowledge,
    seed: 'AgentRunId:test',
    attempt: 1,
    recentItems
  });
  assert.equal(first.mode, 'guided_diversity');
  assert.notEqual(first.directionCode, retry.directionCode);
  assert.equal(first.recentOutlinesToAvoid.length, 1);
  assert.match(first.recentOutlinesToAvoid[0], /削弱论证基础/);
  assert.match(first.recentOutlinesToAvoid[0], /核心概念/);
  assert(content.isNearDuplicateGeneratedContent(recentItems[0].content, recentItems));
  assert(!content.isNearDuplicateGeneratedContent(
    '## 资料分析\n本节讨论增长量比较与基期量估算，并给出新的数据表。',
    recentItems
  ));
  console.log('Generation diversity verification passed.');
} finally {
  await server.close();
}
