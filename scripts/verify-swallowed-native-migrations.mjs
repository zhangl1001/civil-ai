import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { createNodeSqliteDatabase, nativeExecuteSql as nativeExecute } from './support/tutor-test-databases.mjs';
import { cycleA, sqliteCandidateSql, sqliteMetadataSql } from './support/learning-data-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(repoRoot, 'web');
const migrationsDir = path.join(webRoot, 'src/capabilities/database/migrations');
const server = await createServer({
  root: webRoot,
  configFile: false,
  resolve: { alias: { '@': path.join(webRoot, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

try {
  const [{ prepareMigrationSql }, { tutorMigrations }, { MigrationRunner }, { tutorDatabaseConfig }, guards] = await Promise.all([
    server.ssrLoadModule('/src/capabilities/database/migrations/prepareMigrationSql.ts'),
    server.ssrLoadModule('/src/capabilities/database/migrations/tutorMigrations.ts'),
    server.ssrLoadModule('/src/capabilities/database/migrations/MigrationRunner.ts'),
    server.ssrLoadModule('/src/capabilities/database/config/TutorDatabaseConfig.ts'),
    server.ssrLoadModule('/src/capabilities/database/migrations/migrationGuards.ts')
  ]);

  const sql040 = readMigration('040_prompt_exam_scope.sql');
  const sql042 = readMigration('042_daily_plan_block_subject.sql');
  const sql043 = readMigration('043_repair_swallowed_migrations.sql');
  const prepared040 = prepareMigrationSql(sql040);
  const prepared042 = prepareMigrationSql(sql042);
  const repair = tutorMigrations.find((migration) => migration.version === 43);
  assert.equal(tutorMigrations.length, 44);
  assert.equal(repair?.name, 'repair_swallowed_migrations');
  assert.equal(repair?.checksum, `sha256:${createHash('sha256').update(sql043).digest('hex')}`);
  assert.doesNotMatch(sql043, /DELETE FROM/i);

  assert.match(sql040.trimStart(), /^--/);
  assert.match(sql040, /DELETE FROM prompt_versions/);
  assert.doesNotMatch(prepared040.trimStart(), /^--/);
  assert.match(prepared040, /CREATE TABLE prompt_definitions_v40/);
  assert.match(prepared040, /exam_type TEXT NOT NULL DEFAULT 'shared'/);
  assert.match(prepared042, /INSERT INTO daily_plan_blocks_v42 SELECT id/);
  assert.doesNotMatch(prepared042, /daily_plan_blocks_v42SELECT/);
  assert.equal(prepared040.includes('\n'), false);
  assert.equal(prepared042.includes('\n'), false);

  const swallowed040 = nativeExecute(sql040);
  assert.equal(swallowed040.includes('\n'), false);
  assert.match(swallowed040.trimStart(), /^--/);
  assert.match(nativeExecute(sql042), /daily_plan_blocks_v42SELECT id/);
  assert.match(nativeExecute(prepared042), /daily_plan_blocks_v42 SELECT id/);

  verifySqliteRepair(prepared040, prepared042);
  await verifyRunnerRepairsExistingDevice(MigrationRunner, tutorDatabaseConfig, tutorMigrations);
  await verifyRunnerLeavesHealthySchemaAlone(MigrationRunner, tutorDatabaseConfig, tutorMigrations);
  await verifyPlanLinksSurvive042({ MigrationRunner, tutorDatabaseConfig, tutorMigrations, prepareMigrationSql, guards });

  console.log('Swallowed native migration repair verification passed.');
} finally {
  await server.close();
}

function readMigration(name) {
  return readFileSync(path.join(migrationsDir, name), 'utf8');
}

function verifySqliteRepair(prepared040, prepared042) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zhangl-swallowed-migrations-'));
  const databaseFile = path.join(directory, 'tutor.sqlite');
  try {
    const baseline = migrationFiles()
      .filter((name) => !name.startsWith('040_') && !name.startsWith('042_') && !name.startsWith('043_'))
      .map((name) => `.read ${path.join(migrationsDir, name)}`)
      .join('\n');

    runSqlite(databaseFile, `PRAGMA foreign_keys = ON;\n${baseline}`);
    assert.equal(columnExists(databaseFile, 'prompt_definitions', 'exam_type'), false);
    assert.match(tableSql(databaseFile, 'daily_plan_blocks'), /CHECK\(subject IN/);

    runSqlite(databaseFile, nativeExecute(readMigration('040_prompt_exam_scope.sql')));
    assert.equal(columnExists(databaseFile, 'prompt_definitions', 'exam_type'), false, 'iOS execute() must swallow 040');

    const commentStripped042 = readMigration('042_daily_plan_block_subject.sql').split('\n').map((line) => {
      const comment = line.indexOf('--');
      return comment === -1 ? line : line.slice(0, comment);
    }).join('\n');
    const broken042 = nativeExecute(commentStripped042);
    assert.match(broken042, /daily_plan_blocks_v42SELECT id/);
    const probeFile = path.join(directory, 'broken-042.sqlite');
    copyFileSync(databaseFile, probeFile);
    const failed042 = spawnSync('sqlite3', [probeFile], { input: broken042, encoding: 'utf8' });
    assert.notEqual(failed042.status, 0, 'iOS execute() must break 042 INSERT...SELECT');
    assert.match(`${failed042.stderr}${failed042.stdout}`, /near "id"/);

    runSqlite(databaseFile, `${nativeExecute(prepared040)};\n${nativeExecute(prepared042)};`);
    assert.equal(columnExists(databaseFile, 'prompt_definitions', 'exam_type'), true);
    assert.match(tableSql(databaseFile, 'daily_plan_blocks'), /CHECK\(length\(subject\) > 0\)/);
    assert.doesNotMatch(tableSql(databaseFile, 'daily_plan_blocks'), /CHECK\(subject IN/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function verifyRunnerRepairsExistingDevice(MigrationRunner, config, migrations) {
  const promptColumns = ['id', 'prompt_code', 'task_type', 'description', 'status', 'created_at'];
  const state = { planSql: "CREATE TABLE daily_plan_blocks (subject TEXT NOT NULL CHECK(subject IN ('aptitude','essay','interview')))" };
  const database = fakeDatabase({
    applied: migrations.slice(0, 42),
    promptColumns,
    state
  });
  await new MigrationRunner(database, config, migrations).migrate(1);
  assert.equal(database.appliedVersions.at(-1), migrations.at(-1).version);
  assert.equal(promptColumns.includes('exam_type'), true);
  assert.match(state.planSql, /CHECK\(length\(subject\) > 0\)/);
}

async function verifyRunnerLeavesHealthySchemaAlone(MigrationRunner, config, migrations) {
  const promptColumns = ['id', 'exam_type', 'prompt_code', 'task_type', 'description', 'status', 'created_at'];
  const state = { planSql: 'CREATE TABLE daily_plan_blocks (subject TEXT NOT NULL CHECK(length(subject) > 0))' };
  const database = fakeDatabase({
    applied: migrations,
    promptColumns,
    state
  });
  const before = database.executed.length;
  await new MigrationRunner(database, config, migrations).migrate(1);
  const repairSql = database.executed.slice(before).filter((sql) => (
    sql.includes('prompt_definitions_v40') || sql.includes('daily_plan_blocks_v42')
  ));
  assert.deepEqual(repairSql, []);
}

function fakeDatabase({ applied, promptColumns, state }) {
  const appliedRows = applied.map((migration) => ({
    version: migration.version,
    name: migration.name,
    checksum: migration.checksum
  }));
  const executed = [];
  const database = {
    executed,
    get appliedVersions() {
      return appliedRows.map((row) => row.version);
    },
    async open() {},
    async execute(sql) {
      record(sql);
    },
    async run(sql, parameters = []) {
      if (sql.startsWith('INSERT INTO schema_migrations')) {
        appliedRows.push({ version: parameters[0], name: parameters[1], checksum: parameters[2] });
      }
      record(sql);
      return { changes: 1 };
    },
    async query(sql) {
      if (sql.includes('FROM schema_migrations')) return appliedRows;
      if (sql.includes('PRAGMA table_info(prompt_definitions)')) {
        return promptColumns.map((name) => ({ name }));
      }
      if (sql.includes('sqlite_master')) return [{ sql: state.planSql }];
      return [];
    },
    async transaction(work) {
      return work(database);
    }
  };
  return database;

  function record(sql) {
    executed.push(sql);
    if (sql.includes('prompt_definitions_v40')) promptColumns.push('exam_type');
    if (sql.includes('daily_plan_blocks_v42')) {
      state.planSql = 'CREATE TABLE daily_plan_blocks (subject TEXT NOT NULL CHECK(length(subject) > 0))';
    }
  }
}

/**
 * 042 deletes daily_plan_items to rebuild daily_plan_blocks, and
 * learning_progress.daily_plan_item_id is ON DELETE SET NULL. Its guard must keep
 * the link on the normal upgrade and in the repair, under the iOS execute()
 * rewrite; without the guard the same SQL loses it.
 */
async function verifyPlanLinksSurvive042({ MigrationRunner, tutorDatabaseConfig, tutorMigrations, prepareMigrationSql, guards }) {
  const migration042 = tutorMigrations.find((migration) => migration.version === 42);
  assert.equal(migration042.guard, guards.learningProgressPlanLinkGuard, '042 must run with the plan link guard');
  const guarded042 = prepareMigrationSql(guards.guardedMigrationSql(migration042.sql, migration042.guard));
  assert.equal(guarded042.trimEnd().endsWith(';'), true, 'iOS execute() drops whatever follows the last semicolon');
  assert.match(nativeExecute(guarded042), /DROP TABLE learning_progress_plan_links_v42$/);

  const unguarded = deviceAt(41);
  unguarded.raw.exec(nativeExecute(prepareMigrationSql(migration042.sql)));
  assert.equal(planLink(unguarded), null, 'the fixture must reproduce the lost link without the guard');

  const upgraded = deviceAt(41);
  await new MigrationRunner(upgraded, tutorDatabaseConfig, tutorMigrations).migrate(2);
  assertPlanLinkKept(upgraded, 'the normal upgrade through 042');

  // Recorded 040 and 042 without applying them, like iOS did before 043: the repair runs 042 instead.
  const repaired = deviceAt(43, new Set([40, 42]));
  assert.equal(columnNames(repaired, 'prompt_definitions').includes('exam_type'), false);
  await new MigrationRunner(repaired, tutorDatabaseConfig, tutorMigrations).migrate(3);
  assert.equal(columnNames(repaired, 'prompt_definitions').includes('exam_type'), true, 'the repair reapplies 040');
  assertPlanLinkKept(repaired, 'the swallowed-migration repair of 042');

  function deviceAt(version, swallowed = new Set()) {
    const database = createNodeSqliteDatabase();
    database.raw.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL);`);
    for (const migration of tutorMigrations.filter((item) => item.version <= version)) {
      // A swallowed body reaches SQLite as one comment line: the old runner sent it unprepared.
      database.raw.exec(nativeExecute(swallowed.has(migration.version) ? migration.sql : prepareMigrationSql(migration.sql)));
      database.raw.prepare('INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
        .run(migration.version, migration.name, migration.checksum, 1);
    }
    database.raw.exec(`${sqliteMetadataSql()}${sqliteCandidateSql()}
      INSERT INTO daily_plans(id, exam_cycle_id, plan_date, version, status, phase, available_minutes, decision_summary, decision_factors_json, created_by, created_at)
      VALUES ('plan-1', '${cycleA}', '2026-09-01', 1, 'active', 'foundation', 60, '讲义后练习', '{}', 'system', 1);
      INSERT INTO daily_plan_blocks(id, daily_plan_id, capability_node_id, subject, module, teaching_goal_code, sequence, priority, required)
      VALUES ('block-1', 'plan-1', 'capability-1', 'aptitude', '判断推理', 'consolidate', 1, 60, 1);
      INSERT INTO daily_plan_items(id, daily_plan_id, capability_node_id, item_type, sequence, target_minutes, exit_criteria_json, reason, status, daily_plan_block_id)
      VALUES ('item-1', 'plan-1', 'capability-1', 'lecture', 1, 20, '{}', '先读讲义', 'completed', 'block-1');
      INSERT INTO learning_progress(id, exam_cycle_id, resource_type, resource_key, capability_node_id, daily_plan_item_id, status, started_at, completed_at, updated_at)
      VALUES ('progress-1', '${cycleA}', 'lecture', 'lecture-1', 'capability-1', 'item-1', 'completed', 1, 2, 2),
             ('progress-2', '${cycleA}', 'digest', 'digest-1', NULL, NULL, 'started', 1, NULL, 1);`);
    assert.equal(planLink(database), 'item-1');
    return database;
  }

  function assertPlanLinkKept(database, label) {
    assert.equal(planLink(database), 'item-1', `${label} must keep learning_progress.daily_plan_item_id`);
    assert.equal(
      database.raw.prepare("SELECT daily_plan_item_id FROM learning_progress WHERE id = 'progress-2'").get().daily_plan_item_id,
      null,
      `${label} must not invent links`
    );
    assert.match(database.raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'daily_plan_blocks'").get().sql, /CHECK\(length\(subject\) > 0\)/);
    assert.equal(database.raw.prepare("SELECT COUNT(*) AS total FROM daily_plan_items").get().total, 1);
    assert.equal(database.raw.prepare("SELECT COUNT(*) AS total FROM temp.sqlite_master WHERE name LIKE '%_v4%'").get().total, 0);
    assert.equal(database.raw.prepare('SELECT COUNT(*) AS total FROM pragma_foreign_key_check').get().total, 0);
  }

  function planLink(database) {
    return database.raw.prepare("SELECT daily_plan_item_id FROM learning_progress WHERE id = 'progress-1'").get().daily_plan_item_id;
  }

  function columnNames(database, table) {
    return database.raw.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((row) => row.name);
  }
}

function migrationFiles() {
  return readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
}

function columnExists(databaseFile, table, column) {
  const output = runSqlite(databaseFile, `SELECT COUNT(*) FROM pragma_table_info('${table}') WHERE name = '${column}';`);
  return output.trim() === '1';
}

function tableSql(databaseFile, table) {
  return runSqlite(databaseFile, `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${table}';`);
}

function runSqlite(databaseFile, sql) {
  const result = spawnSync('sqlite3', [databaseFile], { input: sql, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `sqlite3 failed: ${sql.slice(0, 180)}`);
  }
  return result.stdout;
}
