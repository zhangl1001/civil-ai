import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import {
  createMemoryConversationStore,
  createMemoryTutorIndexedDb,
  createNodeSqliteDatabase,
  dumpSqliteTables,
  indexedDbKeyPaths
} from './support/tutor-test-databases.mjs';
import {
  cycleA,
  cycleB,
  indexedDbLearningRecords,
  sqliteCandidateSql,
  sqliteLearningSql,
  sqliteMetadataSql,
  sqliteQuestionSourceSql,
  sqliteUnscopedSql
} from './support/learning-data-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

const conversationSession = { id: 'conversation-1', projectId: 'project-1', title: '备考答疑', createdAt: 1000, updatedAt: 1000 };
const conversationMessage = { id: 'conversation-message-1', sessionId: 'conversation-1', role: 'user', content: '削弱题怎么做？', createdAt: 1000 };

try {
  const modules = await loadModules();
  await verifyCleanupIsolation(modules);
  await verifySqliteCleanupCoverage(modules);
  await verifySqliteSnapshotMatchesCleanup(modules);
  const backup = await verifySqliteRoundTrip(modules);
  await verifySqliteImportGuards(modules, backup);
  await verifySqliteFirstImport(modules, backup);
  const legacyBackup = await verifySqliteLegacyImport(modules);
  await verifyIndexedDbRoundTrip(modules, backup);
  await verifyIndexedDbLegacyImport(modules, legacyBackup);
  console.log('Data maintenance isolation, coverage and backup round-trip verification passed.');
} finally {
  await server.close();
}

async function loadModules() {
  const load = (file) => server.ssrLoadModule(`/src/${file}.ts`);
  const [
    sqliteMaintenance, sqliteTables, sqliteScope, indexedDbMaintenance, indexedDbUnitOfWork, indexedDbRecords,
    indexedDb, migrationRunner, migrations, config, backupService, legacyBackup,
    sqliteCandidate, sqliteContent, sqliteGeneration, sqliteThreads, sqliteFacts, sqliteMastery, sqlitePlans,
    sqliteAssets, indexedDbCandidate, indexedDbContent, indexedDbGeneration, indexedDbThreads, indexedDbFacts,
    indexedDbMastery, indexedDbPlans, indexedDbAssets
  ] = await Promise.all([
    'capabilities/database/adapters/sqlite/SqliteTutorDataMaintenance',
    'capabilities/database/adapters/sqlite/SqliteLearningDataTables',
    'capabilities/database/adapters/sqlite/SqlTransactionScope',
    'capabilities/database/adapters/indexeddb/IndexedDbTutorDataMaintenance',
    'capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork',
    'capabilities/database/adapters/indexeddb/IndexedDbLearningRecords',
    'capabilities/database/adapters/indexeddb/TutorIndexedDb',
    'capabilities/database/migrations/MigrationRunner',
    'capabilities/database/migrations/tutorMigrations',
    'capabilities/database/config/TutorDatabaseConfig',
    'services/DataBackupService',
    'services/LegacyLearningBackup',
    'modules/candidate/adapters/SqliteCandidateRepository',
    'modules/content/adapters/SqliteContentRepository',
    'modules/content/adapters/SqliteGenerationRepository',
    'modules/teaching/adapters/SqliteLearningThreadRepository',
    'modules/evidence/adapters/SqliteLearningFactRepositories',
    'modules/mastery/adapters/SqliteMasteryRepository',
    'modules/planning/adapters/SqliteDailyPlanRepository',
    'modules/content/adapters/SqliteLearningAssetRepository',
    'modules/candidate/adapters/IndexedDbCandidateRepository',
    'modules/content/adapters/IndexedDbContentRepository',
    'modules/content/adapters/IndexedDbGenerationRepository',
    'modules/teaching/adapters/IndexedDbLearningThreadRepository',
    'modules/evidence/adapters/IndexedDbLearningFactRepositories',
    'modules/mastery/adapters/IndexedDbMasteryRepository',
    'modules/planning/adapters/IndexedDbDailyPlanRepository',
    'modules/content/adapters/IndexedDbLearningAssetRepository'
  ].map(load));
  const indexedDbSource = await readFile(path.join(root, 'src/capabilities/database/adapters/indexeddb/TutorIndexedDb.ts'), 'utf8');
  return {
    ...sqliteMaintenance, ...sqliteTables, ...sqliteScope, ...indexedDbMaintenance, ...indexedDbUnitOfWork,
    ...indexedDbRecords, ...indexedDb, ...migrationRunner, ...migrations, ...config, ...backupService, ...legacyBackup,
    ...sqliteCandidate, ...sqliteContent, ...sqliteGeneration, ...sqliteThreads, ...sqliteFacts, ...sqliteMastery,
    ...sqlitePlans, ...sqliteAssets, ...indexedDbCandidate, ...indexedDbContent, ...indexedDbGeneration,
    ...indexedDbThreads, ...indexedDbFacts, ...indexedDbMastery, ...indexedDbPlans, ...indexedDbAssets,
    indexedDbKeyPaths: indexedDbKeyPaths(indexedDbSource, indexedDb.TutorIndexedDbStore)
  };
}

async function verifyCleanupIsolation(modules) {
  const sqliteCalls = [];
  const sqliteMaintenance = new modules.SqliteTutorDataMaintenance({
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

  const Store = modules.TutorIndexedDbStore;
  const rows = new Map([
    [Store.ContentQuestionSetBundles, [
      isolationBundle('cycle:a', 'set:a', 'question:a'),
      isolationBundle('cycle:b', 'set:b', 'question:b')
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
  const indexedDbMaintenance = new modules.IndexedDbTutorDataMaintenance({
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
}

/**
 * A backup must carry every table the cleanup reaches: the tables its
 * statements name plus each table an ON DELETE CASCADE or SET NULL key pulls
 * in. A table added to either side without the other fails here.
 */
async function verifySqliteCleanupCoverage(modules) {
  const statements = [];
  await new modules.SqliteTutorDataMaintenance({
    async transaction(work) {
      return work({ async run(sql) { statements.push(sql); return { changes: 0 }; } });
    }
  }, {}).clearLearningData(cycleA);
  const cleared = new Set(statements
    .flatMap((sql) => [...sql.matchAll(/\b(?:DELETE FROM|UPDATE)\s+(\w+)/g)].map((match) => match[1]))
    .filter((table) => table !== 'data_maintenance_context'));

  const database = await migratedSqliteDatabase(modules);
  const tables = database.raw.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  ).all().map((row) => row.name);
  const reached = new Set(cleared);
  for (let grew = true; grew;) {
    grew = false;
    for (const table of tables) {
      if (reached.has(table)) continue;
      const keys = database.raw.prepare(`PRAGMA foreign_key_list(${table})`).all();
      if (keys.some((key) => reached.has(key.table) && ['CASCADE', 'SET NULL'].includes(key.on_delete))) {
        reached.add(table);
        grew = true;
      }
    }
  }
  const restored = modules.sqliteLearningTables.map((entry) => entry.table);
  assert.equal(new Set(restored).size, restored.length, 'each learning table is restored once');
  assert.deepEqual(
    [...reached].sort(),
    [...restored].sort(),
    'the tables clearLearningData deletes from or cascades into must equal the tables a backup restores'
  );
  assert.equal(restored.length, 47);
}

/** The export scopes must select exactly the rows the cleanup deletes; checked against a real cleanup. */
async function verifySqliteSnapshotMatchesCleanup(modules) {
  const database = await seededSqliteDatabase(modules);
  const runtime = sqliteRuntime(modules, database, createMemoryConversationStore());
  const before = dumpSqliteTables(database.raw);
  const snapshot = await runtime.dataMaintenance.exportLearningData(cycleA);
  for (const entry of modules.sqliteLearningTables) {
    assert(snapshot.records[entry.table]?.length > 0, `the fixture must exercise ${entry.table}`);
  }
  let after;
  await assert.rejects(runtime.unitOfWork.run(async (context) => {
    await runtime.dataMaintenance.clearLearningData(cycleA, context);
    after = dumpSqliteTables(database.raw);
    throw new Error('roll back the probe');
  }, { workload: 'maintenance' }), /roll back the probe/);
  for (const table of Object.keys(before)) {
    const remaining = new Set(after[table].map(json));
    const removed = before[table].map(json).filter((row) => !remaining.has(row)).sort();
    const exported = (snapshot.records[table] ?? []).map(json).sort();
    assert.deepEqual(removed, exported, `${table}: the backup must hold exactly the rows the cleanup removes`);
    const original = new Set(before[table].map(json));
    assert.deepEqual(after[table].map(json).filter((row) => !original.has(row)), [], `${table}: cleanup must not rewrite kept rows`);
  }
  assert.deepEqual(sortedDump(dumpSqliteTables(database.raw)), sortedDump(before), 'the probe must roll back');
  assert.deepEqual(snapshot.references.question_sources.map((row) => row.id), ['source-official']);
}

async function verifySqliteRoundTrip(modules) {
  const database = await seededSqliteDatabase(modules);
  const conversations = createMemoryConversationStore([conversationSession], [conversationMessage]);
  const runtime = sqliteRuntime(modules, database, conversations);
  const service = new modules.DataBackupService(async () => runtime);
  const before = sortedDump(dumpSqliteTables(database.raw));
  const backup = JSON.parse(JSON.stringify(await service.exportActiveProject()));
  assert.equal(backup.version, 3);
  assert.equal(backup.learning.storage, 'sqlite');
  assert.equal(backup.learning.schemaVersion, modules.tutorMigrations.at(-1).version);
  const restoredCount = await service.importBackup(backup);
  assert(restoredCount > 47, 'import must report the restored rows');
  const after = sortedDump(dumpSqliteTables(database.raw));
  for (const table of Object.keys(before)) {
    assert.equal(after[table].length, before[table].length, `${table}: row count must survive export and import`);
  }
  assert.deepEqual(after, before, 'export then import must leave every row of every table identical');

  const value = (sql) => database.raw.prepare(sql).get();
  assert.deepEqual(
    { ...value("SELECT status, practice_status FROM question_sets WHERE id = 'a-set-practised'") },
    { status: 'ready', practice_status: 'completed' },
    'a practised question set keeps its progress'
  );
  assert.equal(value("SELECT status FROM question_sets WHERE id = 'a-set-retired'").status, 'retired');
  assert.equal(value("SELECT is_official FROM questions WHERE id = 'a-q4'").is_official, 1);
  assert.equal(value("SELECT action FROM error_diagnosis_confirmations WHERE id = 'a-confirmation'").action, 'correct');
  assert.equal(value("SELECT effective_cause_code FROM error_diagnosis_current_projection WHERE error_diagnosis_id = 'a-diagnosis'").effective_cause_code, 'trap_misjudgment');
  assert.equal(value("SELECT validity_status FROM evidence_validity_projection WHERE evidence_id = 'a-evidence-wrong'").validity_status, 'superseded');
  assert.equal(value("SELECT replacement_evidence_id FROM evidence_corrections WHERE id = 'a-correction'").replacement_evidence_id, 'a-evidence-confirmed');
  assert.equal(value("SELECT learning_session_id FROM tutor_cycle_conclusions WHERE id = 'a-conclusion'").learning_session_id, 'a-session-1');
  assert.equal(value("SELECT snapshot_json FROM ability_calibration_snapshots WHERE id = 'a-calibration'").snapshot_json, '{"estimatedScore":62.5}');
  assert.equal(value("SELECT daily_plan_item_id FROM learning_progress WHERE id = 'a-progress'").daily_plan_item_id, 'a-plan-item');
  assert.equal(value("SELECT parent_agent_run_id FROM tutor_agent_runs WHERE id = 'a-run-child'").parent_agent_run_id, 'a-run-root');
  assert.equal(value("SELECT lease_epoch FROM tutor_agent_runs WHERE id = 'a-run-running'").lease_epoch, 3);
  assert.equal(value('SELECT COUNT(*) AS total FROM pragma_foreign_key_check').total, 0);
  assert.deepEqual(conversations.state.sessions, [conversationSession]);
  assert.deepEqual(conversations.state.messages, [conversationMessage]);
  assert.deepEqual(runtime.activations, [], 'restoring the current cycle keeps its exam track');
  return backup;
}

async function verifySqliteImportGuards(modules, backup) {
  const database = await seededSqliteDatabase(modules);
  const conversations = createMemoryConversationStore([conversationSession], [conversationMessage]);
  const runtime = sqliteRuntime(modules, database, conversations);
  const service = new modules.DataBackupService(async () => runtime);
  const before = sortedDump(dumpSqliteTables(database.raw));
  const unchanged = (label) => assert.deepEqual(sortedDump(dumpSqliteTables(database.raw)), before, `${label} must leave the data untouched`);
  const variant = (change) => {
    const copy = JSON.parse(JSON.stringify(backup));
    change(copy);
    return copy;
  };

  await assert.rejects(service.importBackup(variant((copy) => { copy.learning.storage = 'indexeddb'; })), /该备份来自网页版，iOS 客户端暂不支持跨平台恢复/);
  unchanged('a backup from the other storage kind');
  await assert.rejects(service.importBackup(variant((copy) => { copy.learning.schemaVersion = 999; })), /更新版本的应用.*请升级应用/);
  unchanged('a backup from a newer schema');
  await assert.rejects(service.importBackup(variant((copy) => { copy.learning.records.unknown_table = [{ id: 'x' }]; })), /无法识别的数据（unknown_table）/);
  unchanged('a backup with an unknown table');
  await assert.rejects(service.importBackup(variant((copy) => {
    copy.learning.references.learning_threads = copy.learning.records.learning_threads;
  })), /无法识别的数据（learning_threads）/, 'records filed under references would never be written');
  await assert.rejects(service.importBackup(variant((copy) => {
    copy.learning.records.question_sources = copy.learning.references.question_sources;
  })), /无法识别的数据（question_sources）/);
  unchanged('a backup with groups in the wrong section');
  await assert.rejects(service.importBackup(variant((copy) => {
    copy.learning.records.proactive_signals.push({ ...copy.learning.records.proactive_signals[0], id: 'x-signal', exam_cycle_id: cycleB, dedup_key: 'x-signal' });
  })), /proactive_signals 记录不属于当前备考周期/);
  unchanged('a backup carrying another cycle\'s rows');
  await assert.rejects(service.importBackup(variant((copy) => {
    copy.learning.records.proactive_signals[0]["id) VALUES ('x'); DROP TABLE projects; --"] = 'x';
  })), /字段在当前版本不存在/);
  unchanged('a backup with a forged column');
  const invariant = await service.importBackup(variant((copy) => {
    copy.learning.records.question_sets[0].practice_status = 'abandoned';
  })).then(() => undefined, (error) => error);
  assert(invariant instanceof Error, 'a row the schema rejects must fail the import');
  assert.match(invariant.message, /^导入失败，本地学习数据保持原样（原因：.*CHECK constraint failed/, 'storage errors surface in Chinese');
  unchanged('a row the schema rejects');

  const legacy = await legacyBackupOf(modules, runtime);
  await assert.rejects(service.importBackup(legacy), /旧版（v2）备份.*清空学习数据后导入/);
  unchanged('a v2 backup into a cycle that holds learning data');

  conversations.state.failNextReplace = true;
  await assert.rejects(service.importBackup(variant((copy) => {
    copy.learning.records.learning_progress[0].status = 'started';
    copy.learning.records.question_sets[0].practice_status = 'in_progress';
  })), /对话记录导入失败，学习数据已恢复到导入前的状态/);
  unchanged('an import whose conversations fail after the learning data committed');
  assert.deepEqual(conversations.state.sessions, [conversationSession]);

  // Reference checks cover the restored cycle only: another cycle's broken link neither blocks nor gets rewritten.
  database.raw.exec(`PRAGMA foreign_keys = OFF;
    INSERT INTO learning_progress(id, exam_cycle_id, resource_type, resource_key, daily_plan_item_id, status, started_at, updated_at)
    VALUES ('b-dangling-progress', '${cycleB}', 'digest', 'digest:1', 'missing-plan-item', 'started', 1, 1);
    PRAGMA foreign_keys = ON;`);
  await service.importBackup(backup);
  assert.equal(
    database.raw.prepare("SELECT daily_plan_item_id FROM learning_progress WHERE id = 'b-dangling-progress'").get().daily_plan_item_id,
    'missing-plan-item'
  );
}

/** A fresh device holds no cycle and no question sources; the backup must bring both. */
async function verifySqliteFirstImport(modules, backup) {
  // The same paper imported again on this device got its own id; the backup cannot be merged onto it.
  const twin = await migratedSqliteDatabase(modules, `${sqliteMetadataSql()}
    ${sqliteQuestionSourceSql().replace("'source-official'", "'source-reimported'")}`);
  const twinBefore = sortedDump(dumpSqliteTables(twin.raw));
  await assert.rejects(
    new modules.DataBackupService(async () => sqliteRuntime(modules, twin, createMemoryConversationStore())).importBackup(backup),
    /本机已导入过同一份题目来源（测试真题），但编号与备份不同/
  );
  assert.deepEqual(sortedDump(dumpSqliteTables(twin.raw)), twinBefore, 'a refused first import must create nothing');

  const database = await migratedSqliteDatabase(modules, sqliteMetadataSql());
  const runtime = sqliteRuntime(modules, database, createMemoryConversationStore());
  await new modules.DataBackupService(async () => runtime).importBackup(JSON.parse(JSON.stringify(backup)));
  assert.equal((await runtime.candidateRepository.findCurrentCycle())?.examCycle.id, cycleA);
  assert.deepEqual(runtime.activations, ['activated'], 'a first import points the runtime at the imported exam track');
  const restored = JSON.parse(JSON.stringify(await runtime.dataMaintenance.exportLearningData(cycleA)));
  for (const entry of modules.sqliteLearningTables) {
    assert.deepEqual(
      restored.records[entry.table].map(json).sort(),
      backup.learning.records[entry.table].map(json).sort(),
      `${entry.table}: a first import must restore the backup's rows`
    );
  }
  assert.deepEqual(restored.references, backup.learning.references, 'cited question sources come with the backup');
  assert.equal(database.raw.prepare('SELECT COUNT(*) AS total FROM pragma_foreign_key_check').get().total, 0);
}

/** v2 files still import into a cycle holding no learning data, keeping practised and retired sets. */
async function verifySqliteLegacyImport(modules) {
  const source = await seededSqliteDatabase(modules);
  const legacy = await legacyBackupOf(modules, sqliteRuntime(modules, source, createMemoryConversationStore()));
  const database = await migratedSqliteDatabase(modules, sqliteMetadataSql());
  const runtime = sqliteRuntime(modules, database, createMemoryConversationStore());
  const service = new modules.DataBackupService(async () => runtime);
  assert(await service.importBackup(legacy) > 0);
  const rows = (sql) => database.raw.prepare(sql).all().map((row) => ({ ...row }));
  assert.deepEqual(rows(`SELECT id, status, practice_status FROM question_sets ORDER BY id`), [
    { id: 'a-set-official', status: 'ready', practice_status: 'not_started' },
    { id: 'a-set-practised', status: 'ready', practice_status: 'completed' },
    { id: 'a-set-retired', status: 'retired', practice_status: 'in_progress' }
  ]);
  assert.deepEqual(rows(`SELECT id, is_official FROM questions WHERE is_official = 1`), [{ id: 'a-q4', is_official: 1 }]);
  const counts = rows(`SELECT
    (SELECT COUNT(*) FROM generation_specs) AS specs, (SELECT COUNT(*) FROM learning_sessions) AS sessions,
    (SELECT COUNT(*) FROM attempts) AS attempts, (SELECT COUNT(*) FROM error_diagnoses) AS diagnoses,
    (SELECT COUNT(*) FROM learning_evidence) AS evidence, (SELECT COUNT(*) FROM review_queue) AS reviews,
    (SELECT COUNT(*) FROM daily_plans) AS plans, (SELECT COUNT(*) FROM learning_assets) AS assets,
    (SELECT COUNT(*) FROM learning_threads) AS threads`)[0];
  assert.deepEqual(counts, { specs: 3, sessions: 2, attempts: 2, diagnoses: 1, evidence: 2, reviews: 1, plans: 2, assets: 2, threads: 1 });
  // v2 never carried agent runs, blueprints or superseded evidence, so references to them are released.
  assert.deepEqual(rows(`SELECT source_agent_run_id, teaching_blueprint_id FROM generation_specs WHERE id = 'a-spec-practised'`), [{ source_agent_run_id: null, teaching_blueprint_id: null }]);
  assert.deepEqual(rows(`SELECT source_evidence_id FROM review_queue`), [{ source_evidence_id: null }]);
  assert.deepEqual(rows(`SELECT review_queue_item_id FROM learning_sessions WHERE id = 'a-session-1'`), [{ review_queue_item_id: 'a-review' }]);
  assert.equal(database.raw.prepare('SELECT COUNT(*) AS total FROM pragma_foreign_key_check').get().total, 0);
  const summary = await service.getSummary();
  assert.equal(summary.questions, 4);
  assert.equal(summary.wrongItems, 1);
  return legacy;
}

async function verifyIndexedDbRoundTrip(modules, sqliteBackup) {
  const Store = modules.TutorIndexedDbStore;
  const database = createMemoryTutorIndexedDb(modules.indexedDbKeyPaths);
  const seed = [cycleA, cycleB].flatMap((cycle) => Object.entries(indexedDbLearningRecords(Store, cycle, cycle === cycleA ? 'a' : 'b'))
    .flatMap(([store, records]) => records.map((value) => ({ type: 'put', store, value }))));
  await database.writeBatch([
    ...seed,
    { type: 'put', store: Store.QuestionSources, value: { id: 'source-official', identityHash: 'source-identity', contentHash: 'source-content', status: 'active' } },
    { type: 'put', store: Store.CandidateCycleBundles, value: { projectId: 'project-1', status: 'active', updatedAt: 1000, bundle: sqliteBackup.candidate } },
    { type: 'put', store: Store.CommandReceipts, value: { idempotencyKey: 'create-cycle:1', commandType: 'candidate.create_cycle' } }
  ]);
  const conversations = createMemoryConversationStore([conversationSession], [conversationMessage]);
  const runtime = indexedDbRuntime(modules, database, conversations);
  const service = new modules.DataBackupService(async () => runtime);
  const before = database.dump();

  const staged = [];
  const recordingScope = { stage: (_context, operation) => staged.push(operation) };
  await new modules.IndexedDbTutorDataMaintenance(database, recordingScope).clearLearningData(cycleA, {});
  const backup = JSON.parse(JSON.stringify(await service.exportActiveProject()));
  assert.equal(backup.learning.storage, 'indexeddb');
  const exportedKeys = new Set(Object.entries(backup.learning.records).flatMap(([store, records]) => (
    records.map((value) => `${store}:${JSON.stringify(modules.keyOf(store, value))}`)
  )));
  assert(staged.length > 0);
  for (const operation of staged) {
    assert(exportedKeys.has(`${operation.store}:${JSON.stringify(operation.key)}`), `${operation.store} ${operation.key}: every record the cleanup deletes must be in the backup`);
  }
  assert.equal(exportedKeys.size, staged.length, 'the backup must hold only records the cleanup deletes');
  for (const store of modules.learningRecordStores) {
    assert(backup.learning.records[store]?.length > 0, `the fixture must exercise ${store}`);
  }

  assert(await service.importBackup(backup) > 0);
  assert.deepEqual(database.dump(), before, 'export then import must leave every IndexedDB record identical');

  const variant = (change) => {
    const copy = JSON.parse(JSON.stringify(backup));
    change(copy);
    return copy;
  };
  await assert.rejects(service.importBackup(variant((copy) => {
    copy.learning.records[Store.ProactiveSignals].push({ id: 'x-signal', examCycleId: cycleB, status: 'pending' });
  })), /proactive_signals 记录不属于当前备考周期/);
  await assert.rejects(service.importBackup(sqliteBackup), /该备份来自iOS 客户端，网页版暂不支持跨平台恢复/);
  await assert.rejects(service.importBackup(variant((copy) => {
    copy.learning.records[Store.QuestionSources] = copy.learning.references[Store.QuestionSources];
  })), /无法识别的数据（question_sources）/);
  assert.deepEqual(database.dump(), before, 'rejected imports must leave IndexedDB untouched');

  const twin = createMemoryTutorIndexedDb(modules.indexedDbKeyPaths);
  await twin.writeBatch([{
    type: 'put', store: Store.QuestionSources,
    value: { id: 'source-reimported', identityHash: 'source-identity', contentHash: 'source-content', status: 'active' }
  }]);
  const twinBefore = twin.dump();
  await assert.rejects(
    new modules.DataBackupService(async () => indexedDbRuntime(modules, twin, createMemoryConversationStore())).importBackup(backup),
    /本机已导入过同一份题目来源（source-official），但编号与备份不同/
  );
  assert.deepEqual(twin.dump(), twinBefore, 'a refused first import must leave IndexedDB untouched');

  const fresh = createMemoryTutorIndexedDb(modules.indexedDbKeyPaths);
  const freshRuntime = indexedDbRuntime(modules, fresh, createMemoryConversationStore());
  await new modules.DataBackupService(async () => freshRuntime).importBackup(backup);
  const restored = JSON.parse(JSON.stringify(await freshRuntime.dataMaintenance.exportLearningData(cycleA)));
  assert.deepEqual(restored.records, backup.learning.records, 'a first import into an empty browser restores every record');
  assert.deepEqual(restored.references, backup.learning.references);
}

async function verifyIndexedDbLegacyImport(modules, legacy) {
  const Store = modules.TutorIndexedDbStore;
  const database = createMemoryTutorIndexedDb(modules.indexedDbKeyPaths);
  const service = new modules.DataBackupService(async () => indexedDbRuntime(modules, database, createMemoryConversationStore()));
  assert(await service.importBackup(legacy) > 0);
  const stored = database.dump();
  assert.deepEqual(
    stored[Store.ContentQuestionSetBundles].map((record) => [record.questionSetId, record.bundle.questionSet.status, record.bundle.questionSet.practiceStatus]),
    [['a-set-official', 'ready', 'not_started'], ['a-set-practised', 'ready', 'completed'], ['a-set-retired', 'retired', 'in_progress']]
  );
  assert.equal(stored[Store.GenerationAggregates].length, 3);
  assert.equal(stored[Store.LearningSessionFacts].length, 2);
  assert.equal(stored[Store.DailyPlanAggregates].length, 2);
  assert.equal((await service.getSummary()).questions, 4);
}

async function legacyBackupOf(modules, runtime) {
  const candidate = await runtime.candidateRepository.findCurrentCycle();
  return JSON.parse(JSON.stringify({
    app: 'zhangl-agent',
    version: 2,
    exportedAt: 2000,
    project: { id: candidate.project.id, name: candidate.project.name },
    candidate,
    learning: await modules.collectLegacyLearningRecords(runtime, candidate.examCycle.id),
    conversations: { sessions: [conversationSession], messages: [conversationMessage] }
  }));
}

async function migratedSqliteDatabase(modules, seedSql = '') {
  const database = createNodeSqliteDatabase();
  await new modules.MigrationRunner(database, modules.tutorDatabaseConfig, modules.tutorMigrations).migrate(1000);
  // The fixture closes a session -> review -> evidence -> attempt cycle, so it loads like a restore does.
  if (seedSql) database.raw.exec(`BEGIN; PRAGMA defer_foreign_keys = ON; ${seedSql} COMMIT;`);
  return database;
}

function seededSqliteDatabase(modules) {
  return migratedSqliteDatabase(modules, [
    sqliteMetadataSql(),
    sqliteQuestionSourceSql(),
    sqliteCandidateSql(),
    sqliteLearningSql(cycleA, 'a', 1),
    sqliteLearningSql(cycleB, 'b', 2),
    sqliteUnscopedSql()
  ].join('\n'));
}

function sqliteRuntime(modules, database, conversationStore) {
  const scope = new modules.SqlTransactionScope();
  const activations = [];
  return {
    activations,
    activateExamPack: async () => { activations.push('activated'); },
    unitOfWork: new modules.SqlUnitOfWork(database, scope),
    dataMaintenance: new modules.SqliteTutorDataMaintenance(database, scope),
    candidateRepository: new modules.SqliteCandidateRepository(database, scope),
    contentRepository: new modules.SqliteContentRepository(database, scope),
    generationRepository: new modules.SqliteGenerationRepository(database, scope),
    learningThreadRepository: new modules.SqliteLearningThreadRepository(database, scope),
    learningSessionRepository: new modules.SqliteLearningSessionRepository(database, scope),
    errorDiagnosisRepository: new modules.SqliteErrorDiagnosisRepository(database, scope),
    learningEvidenceRepository: new modules.SqliteLearningEvidenceRepository(database, scope),
    masteryRepository: new modules.SqliteMasteryRepository(database, scope),
    dailyPlanRepository: new modules.SqliteDailyPlanRepository(database, scope),
    learningAssetRepository: new modules.SqliteLearningAssetRepository(database, scope),
    conversationStore
  };
}

function indexedDbRuntime(modules, database, conversationStore) {
  const scope = new modules.IndexedDbTransactionScope();
  const activations = [];
  return {
    activations,
    activateExamPack: async () => { activations.push('activated'); },
    unitOfWork: new modules.IndexedDbUnitOfWork(database, scope),
    dataMaintenance: new modules.IndexedDbTutorDataMaintenance(database, scope),
    candidateRepository: new modules.IndexedDbCandidateRepository(database, scope),
    contentRepository: new modules.IndexedDbContentRepository(database, scope),
    generationRepository: new modules.IndexedDbGenerationRepository(database, scope),
    learningThreadRepository: new modules.IndexedDbLearningThreadRepository(database, scope),
    learningSessionRepository: new modules.IndexedDbLearningSessionRepository(database, scope),
    errorDiagnosisRepository: new modules.IndexedDbErrorDiagnosisRepository(database, scope),
    learningEvidenceRepository: new modules.IndexedDbLearningEvidenceRepository(database, scope),
    masteryRepository: new modules.IndexedDbMasteryRepository(database, scope),
    dailyPlanRepository: new modules.IndexedDbDailyPlanRepository(database, scope),
    learningAssetRepository: new modules.IndexedDbLearningAssetRepository(database, scope),
    conversationStore
  };
}

function sortedDump(dump) {
  return Object.fromEntries(Object.entries(dump).map(([table, rows]) => [table, rows.map(json).sort()]));
}

function json(value) {
  return JSON.stringify(value);
}

function isolationBundle(examCycleId, questionSetId, questionId) {
  return {
    questionSetId,
    bundle: {
      questionSet: { id: questionSetId, examCycleId },
      questions: [{ id: questionId }]
    }
  };
}
