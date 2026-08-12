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
  const sqlite = await server.ssrLoadModule(
    '/src/capabilities/database/adapters/sqlite/SqliteTutorDataMaintenance.ts'
  );
  const indexedDb = await server.ssrLoadModule(
    '/src/capabilities/database/adapters/indexeddb/IndexedDbTutorDataMaintenance.ts'
  );
  const database = await server.ssrLoadModule(
    '/src/capabilities/database/adapters/indexeddb/TutorIndexedDb.ts'
  );

  const sqliteCalls = [];
  const sqliteMaintenance = new sqlite.SqliteTutorDataMaintenance({
    async transaction(work) {
      return work({
        async run(sql, parameters = []) {
          sqliteCalls.push({ sql, parameters });
          return { changes: 0 };
        }
      });
    }
  }, {});
  await sqliteMaintenance.clearLearningData('cycle:a');
  for (const table of ['domain_outbox', 'system_messages']) {
    const call = sqliteCalls.find((item) => item.sql.includes(`DELETE FROM ${table}`));
    assert(call, `${table} cleanup must exist`);
    assert.match(call.sql, /WHERE/i, `${table} cleanup must be cycle scoped`);
    assert(call.parameters.length > 0, `${table} cleanup must bind the cycle id`);
    assert(call.parameters.every((value) => value === 'cycle:a'));
  }

  const Store = database.TutorIndexedDbStore;
  const rows = new Map([
    [Store.ContentQuestionSetBundles, [
      questionSetBundle('cycle:a', 'set:a', 'question:a'),
      questionSetBundle('cycle:b', 'set:b', 'question:b')
    ]],
    [Store.DomainOutbox, [
      { id: 'outbox:a', aggregateType: 'question_set', aggregateId: 'set:a' },
      { id: 'outbox:b', aggregateType: 'question_set', aggregateId: 'set:b' }
    ]],
    [Store.SystemMessages, [
      { id: 'message:a', sourceType: 'exam_cycle', sourceId: 'cycle:a' },
      { id: 'message:b', sourceType: 'exam_cycle', sourceId: 'cycle:b' }
    ]]
  ]);
  let operations = [];
  const indexedDbMaintenance = new indexedDb.IndexedDbTutorDataMaintenance({
    async getAll(store) { return rows.get(store) || []; },
    async writeBatch(next) { operations = [...next]; }
  }, {});
  await indexedDbMaintenance.clearLearningData('cycle:a');
  const deletedKeys = new Set(operations
    .filter((operation) => operation.type === 'delete')
    .map((operation) => Array.isArray(operation.key) ? operation.key.join(':') : operation.key));
  assert(deletedKeys.has('outbox:a'));
  assert(deletedKeys.has('message:a'));
  assert(!deletedKeys.has('outbox:b'), 'clearing cycle A must preserve cycle B outbox events');
  assert(!deletedKeys.has('message:b'), 'clearing cycle A must preserve cycle B messages');

  console.log('Data maintenance isolation verification passed.');
} finally {
  await server.close();
}

function questionSetBundle(examCycleId, questionSetId, questionId) {
  return {
    questionSetId,
    bundle: {
      questionSet: { id: questionSetId, examCycleId },
      questions: [{ id: questionId }]
    }
  };
}
