import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const webRoot = path.join(projectRoot, 'web');
const server = await createServer({
  root: webRoot,
  configFile: false,
  resolve: { alias: { '@': path.join(webRoot, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

try {
  const content = await server.ssrLoadModule('/src/modules/content/public.ts');
  const fixturePath = path.join(webRoot, 'src/modules/content/fixtures/single-choice-weakening-v1.json');
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  const validator = new content.ContentSchemaValidator();

  const valid = validator.parseSingleChoiceQuestion(fixture);
  assert.equal(valid.ok, true);
  assert.equal(valid.value.options.length, 4);
  assert.equal(valid.value.correctOptionId, 'B');
  assert.equal(valid.value.explanation.blocks[0].type, content.ContentBlockType.Callout);

  const wrongAnswer = validator.parseSingleChoiceQuestion({ ...fixture, correctOptionId: 'E' });
  assert.equal(wrongAnswer.ok, false);
  assert(wrongAnswer.error.issues.some((issue) => issue.code === 'question.answer_missing'));

  const duplicateOptions = validator.parseSingleChoiceQuestion({
    ...fixture,
    options: fixture.options.map((option, index) => ({ ...option, id: index < 2 ? 'A' : option.id }))
  });
  assert.equal(duplicateOptions.ok, false);
  assert(duplicateOptions.error.issues.some((issue) => issue.code === 'question.option_id_duplicate'));

  const objectAsMarkdown = validator.parseDocument({
    schemaVersion: 'content.v1',
    blocks: [{ id: 'bad', type: 'markdown', source: { text: '不能静默转字符串' } }]
  });
  assert.equal(objectAsMarkdown.ok, false);
  assert.equal(objectAsMarkdown.error.issues[0].path, '$.blocks[0].source');

  const badTable = validator.parseDocument({
    schemaVersion: 'content.v1',
    blocks: [{
      id: 'table',
      type: 'data_table',
      columns: [{ key: 'value', label: '数值', alignment: 'right', valueType: 'number' }],
      rows: [{ value: { nested: true } }]
    }]
  });
  assert.equal(badTable.ok, false);
  assert(badTable.error.issues.some((issue) => issue.code === 'content.table_cell_invalid'));

  console.log('Content schema verification passed.');
} finally {
  await server.close();
}

