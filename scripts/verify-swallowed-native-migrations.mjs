import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

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
  const [{ prepareMigrationSql }, { tutorMigrations }, { MigrationRunner }, { tutorDatabaseConfig }] = await Promise.all([
    server.ssrLoadModule('/src/capabilities/database/migrations/prepareMigrationSql.ts'),
    server.ssrLoadModule('/src/capabilities/database/migrations/tutorMigrations.ts'),
    server.ssrLoadModule('/src/capabilities/database/migrations/MigrationRunner.ts'),
    server.ssrLoadModule('/src/capabilities/database/config/TutorDatabaseConfig.ts')
  ]);

  const sql040 = readMigration('040_prompt_exam_scope.sql');
  const sql042 = readMigration('042_daily_plan_block_subject.sql');
  const sql043 = readMigration('043_repair_swallowed_migrations.sql');
  const prepared040 = prepareMigrationSql(sql040);
  const prepared042 = prepareMigrationSql(sql042);
  const repair = tutorMigrations.find((migration) => migration.version === 43);
  assert.equal(tutorMigrations.length, 43);
  assert.equal(repair?.name, 'repair_swallowed_migrations');
  assert.equal(repair?.checksum, `sha256:${createHash('sha256').update(sql043).digest('hex')}`);
  assert.doesNotMatch(sql043, /DELETE FROM/i);

  assert.match(sql040.trimStart(), /^--/);
  assert.match(sql040, /DELETE FROM prompt_versions/);
  assert.doesNotMatch(prepared040.trimStart(), /^--/);
  assert.match(prepared040, /CREATE TABLE prompt_definitions_v40/);
  assert.match(prepared040, /exam_type TEXT NOT NULL DEFAULT 'shared'/);

  const swallowed040 = iosExecute(sql040);
  assert.equal(swallowed040.includes('\n'), false);
  assert.match(swallowed040.trimStart(), /^--/);

  verifySqliteRepair(prepared040, prepared042);
  await verifyRunnerRepairsExistingDevice(MigrationRunner, tutorDatabaseConfig, tutorMigrations);
  await verifyRunnerLeavesHealthySchemaAlone(MigrationRunner, tutorDatabaseConfig, tutorMigrations);

  console.log('Swallowed native migration repair verification passed.');
} finally {
  await server.close();
}

function readMigration(name) {
  return readFileSync(path.join(migrationsDir, name), 'utf8');
}

function iosExecute(sql) {
  return /DELETE FROM/i.test(sql) ? sql.replace(/\n/g, '') : sql;
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

    runSqlite(databaseFile, iosExecute(readMigration('040_prompt_exam_scope.sql')));
    assert.equal(columnExists(databaseFile, 'prompt_definitions', 'exam_type'), false, 'iOS execute() must swallow 040');

    runSqlite(databaseFile, `${prepared040};\n${prepared042};`);
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
  assert.equal(database.appliedVersions.at(-1), 43);
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
