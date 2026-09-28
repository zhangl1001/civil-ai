import type { SqlBatchStatement, SqlRow, SqlTransaction, SqlValue } from '../../contracts/SqlDatabase';
import {
  LearningDataSnapshotError,
  LearningDataStorage,
  type LearningDataRecord,
  type LearningDataSnapshot
} from '../../contracts/TutorDataMaintenance';
import {
  assertSnapshotFits,
  foreignRecordsError,
  snapshotRows,
  sourceIdentityConflictError
} from '../../internal/LearningDataSnapshotPolicy';
import {
  scopeParameters,
  sqliteLearningReferences,
  sqliteLearningTables,
  type SqliteLearningTable
} from './SqliteLearningDataTables';

const insertBatchSize = 100;
const snapshotGroups = {
  records: new Set(sqliteLearningTables.map((entry) => entry.table)),
  references: new Set(sqliteLearningReferences.map((entry) => entry.table))
};

interface CountRow extends SqlRow {
  readonly total: number;
}

interface VersionRow extends SqlRow {
  readonly version: number | null;
}

interface ColumnRow extends SqlRow {
  readonly name: string;
  readonly notnull: number;
}

interface ForeignKeyRow extends SqlRow {
  readonly id: number;
  readonly table: string;
  readonly from: string;
}

interface ViolationRow extends SqlRow {
  readonly rowid: number | null;
  readonly parent: string;
  readonly fkid: number;
}

interface RowIdRow extends SqlRow {
  readonly rowid: number;
}

export async function readSqliteLearningData(
  transaction: SqlTransaction,
  examCycleId: string
): Promise<LearningDataSnapshot> {
  return {
    storage: LearningDataStorage.Sqlite,
    schemaVersion: await appliedSchemaVersion(transaction),
    records: await readTables(transaction, sqliteLearningTables, examCycleId),
    references: await readTables(transaction, sqliteLearningReferences, examCycleId)
  };
}

/** Writes a snapshot into a cycle with no learning rows; the caller's transaction must be a maintenance one. */
export async function writeSqliteLearningData(
  transaction: SqlTransaction,
  examCycleId: string,
  snapshot: LearningDataSnapshot
): Promise<number> {
  assertSnapshotFits(snapshot, LearningDataStorage.Sqlite, await appliedSchemaVersion(transaction), snapshotGroups);
  // Foreign keys are checked at COMMIT instead, so row order only has to satisfy the insert triggers.
  await transaction.execute('PRAGMA defer_foreign_keys = ON;');
  for (const entry of sqliteLearningReferences) {
    const rows = snapshotRows(snapshot.references, entry.table);
    await assertNoIdentityConflict(transaction, entry, rows);
    await insertRows(transaction, entry.table, rows, 'INSERT OR IGNORE');
  }
  let restored = 0;
  for (const entry of sqliteLearningTables) {
    const rows = snapshotRows(snapshot.records, entry.table);
    if (entry.replacesTriggerRows) {
      await transaction.run(`DELETE FROM ${entry.table} WHERE ${entry.scope}`, scopeParameters(entry.scope, examCycleId));
    }
    await insertRows(transaction, entry.table, rows, 'INSERT');
    restored += rows.length;
  }
  await assertRowsBelongToCycle(transaction, examCycleId, snapshot);
  for (const entry of sqliteLearningTables) {
    const violations = await cycleViolations(transaction, entry, examCycleId);
    if (violations.length) throw missingReferenceError(entry.table, violations[0].parent);
  }
  return restored;
}

/**
 * Legacy business backups never carried agent runs, blueprints or corrections.
 * Optional references to such rows are released; a required one fails the restore.
 */
export async function releaseMissingLegacyReferences(transaction: SqlTransaction, examCycleId: string): Promise<void> {
  for (const entry of sqliteLearningTables) {
    const violations = await cycleViolations(transaction, entry, examCycleId);
    if (!violations.length) continue;
    const [foreignKeys, columns] = await Promise.all([
      transaction.query<ForeignKeyRow>(`PRAGMA foreign_key_list(${entry.table})`),
      transaction.query<ColumnRow>(`PRAGMA table_info(${entry.table})`)
    ]);
    for (const [foreignKeyId, rowIds] of groupViolations(violations)) {
      const foreignKey = foreignKeys.find((item) => Number(item.id) === foreignKeyId);
      const column = columns.find((item) => item.name === foreignKey?.from);
      if (!foreignKey || !column || Number(column.notnull) === 1) {
        throw missingReferenceError(entry.table, foreignKey?.table ?? violations[0].parent);
      }
      for (let index = 0; index < rowIds.length; index += insertBatchSize) {
        const chunk = rowIds.slice(index, index + insertBatchSize);
        await transaction.run(
          `UPDATE ${entry.table} SET ${foreignKey.from} = NULL WHERE rowid IN (${chunk.map(() => '?').join(', ')})`,
          chunk
        );
      }
    }
  }
}

async function readTables(
  transaction: SqlTransaction,
  entries: readonly SqliteLearningTable[],
  examCycleId: string
): Promise<Record<string, LearningDataRecord[]>> {
  const groups: Record<string, LearningDataRecord[]> = {};
  for (const entry of entries) {
    const rows = await transaction.query<SqlRow>(
      `SELECT * FROM ${entry.table} WHERE ${entry.scope} ORDER BY rowid`,
      scopeParameters(entry.scope, examCycleId)
    );
    groups[entry.table] = rows.map((row) => ({ ...row }));
  }
  return groups;
}

async function insertRows(
  transaction: SqlTransaction,
  table: string,
  rows: readonly LearningDataRecord[],
  verb: 'INSERT' | 'INSERT OR IGNORE'
): Promise<void> {
  if (!rows.length) return;
  const columns = new Set((await transaction.query<ColumnRow>(`PRAGMA table_info(${table})`)).map((row) => row.name));
  const statements = rows.map((row) => insertStatement(table, columns, row, verb));
  for (let index = 0; index < statements.length; index += insertBatchSize) {
    const chunk = statements.slice(index, index + insertBatchSize);
    if (transaction.runBatch) {
      await transaction.runBatch(chunk);
    } else {
      for (const statement of chunk) await transaction.run(statement.sql, statement.parameters);
    }
  }
}

function insertStatement(
  table: string,
  columns: ReadonlySet<string>,
  row: LearningDataRecord,
  verb: 'INSERT' | 'INSERT OR IGNORE'
): SqlBatchStatement {
  const names = Object.keys(row);
  if (!names.length) throw new LearningDataSnapshotError(`备份中的 ${table} 记录为空`);
  const parameters = names.map((name) => {
    // Column names come from the file, so only the table's own columns may reach the SQL text.
    if (!columns.has(name)) throw new LearningDataSnapshotError(`备份中的 ${table}.${name} 字段在当前版本不存在`);
    return sqlValue(table, name, row[name]);
  });
  return {
    sql: `${verb} INTO ${table}(${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    parameters
  };
}

function sqlValue(table: string, column: string, value: unknown): SqlValue {
  if (value === null || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new LearningDataSnapshotError(`备份中的 ${table}.${column} 取值格式不正确`);
}

/**
 * Shared rows get their id on the device that created them. The same source
 * imported again elsewhere has another id, so INSERT OR IGNORE would skip the
 * backup's row and leave every link to it dangling.
 */
async function assertNoIdentityConflict(
  transaction: SqlTransaction,
  entry: SqliteLearningTable,
  rows: readonly LearningDataRecord[]
): Promise<void> {
  const columns = entry.identityColumns ?? [];
  if (!columns.length) return;
  for (const row of rows) {
    const values = columns.map((column) => sqlValue(entry.table, column, row[column] ?? null));
    const conflicts = await transaction.query<SqlRow>(
      `SELECT id FROM ${entry.table} WHERE id <> ? AND (${columns.map((column) => `${column} = ?`).join(' OR ')}) LIMIT 1`,
      [sqlValue(entry.table, 'id', row.id ?? null), ...values]
    );
    if (conflicts.length) throw sourceIdentityConflictError(String(row.paper_name ?? row.provider ?? row.id));
  }
}

/** After the writes, each table's cycle scope must hold exactly the backup's rows and nothing else. */
async function assertRowsBelongToCycle(
  transaction: SqlTransaction,
  examCycleId: string,
  snapshot: LearningDataSnapshot
): Promise<void> {
  for (const entry of sqliteLearningTables) {
    const rows = await transaction.query<CountRow>(
      `SELECT COUNT(*) AS total FROM ${entry.table} WHERE ${entry.scope}`,
      scopeParameters(entry.scope, examCycleId)
    );
    if (Number(rows[0]?.total ?? 0) !== snapshotRows(snapshot.records, entry.table).length) {
      throw foreignRecordsError(entry.table);
    }
  }
}

/** Foreign-key violations among this cycle's rows only, so another cycle's history never blocks a restore. */
async function cycleViolations(
  transaction: SqlTransaction,
  entry: SqliteLearningTable,
  examCycleId: string
): Promise<readonly ViolationRow[]> {
  const violations = await transaction.query<ViolationRow>(`PRAGMA foreign_key_check(${entry.table})`);
  const rowIds = violations.flatMap((violation) => (violation.rowid === null ? [] : [Number(violation.rowid)]));
  const owned = new Set<number>();
  for (let index = 0; index < rowIds.length; index += insertBatchSize) {
    const chunk = rowIds.slice(index, index + insertBatchSize);
    const rows = await transaction.query<RowIdRow>(
      `SELECT rowid FROM ${entry.table} WHERE rowid IN (${chunk.map(() => '?').join(', ')}) AND (${entry.scope})`,
      [...chunk, ...scopeParameters(entry.scope, examCycleId)]
    );
    rows.forEach((row) => owned.add(Number(row.rowid)));
  }
  return violations.filter((violation) => violation.rowid !== null && owned.has(Number(violation.rowid)));
}

async function appliedSchemaVersion(transaction: SqlTransaction): Promise<number> {
  const rows = await transaction.query<VersionRow>('SELECT MAX(version) AS version FROM schema_migrations');
  return Number(rows[0]?.version ?? 0);
}

function groupViolations(violations: readonly ViolationRow[]): Map<number, number[]> {
  const groups = new Map<number, number[]>();
  for (const violation of violations) {
    const rowIds = groups.get(Number(violation.fkid)) ?? [];
    rowIds.push(Number(violation.rowid));
    groups.set(Number(violation.fkid), rowIds);
  }
  return groups;
}

function missingReferenceError(table: string, parent: string): LearningDataSnapshotError {
  return new LearningDataSnapshotError(
    `备份中的 ${table} 记录引用了本机缺少的 ${parent} 数据，可能来自不同版本的应用，无法恢复`
  );
}
