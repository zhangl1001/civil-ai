import type { SqlDatabase, SqlRow } from '../contracts/SqlDatabase';
import { TransactionWorkload } from '../contracts/UnitOfWork';
import promptExamScopeSql from './040_prompt_exam_scope.sql?raw';
import dailyPlanBlockSubjectSql from './042_daily_plan_block_subject.sql?raw';
import { prepareMigrationSql } from './prepareMigrationSql';

interface TableInfoRow extends SqlRow {
  readonly name?: string;
}

interface SqliteMasterRow extends SqlRow {
  readonly sql?: string | null;
}

/**
 * 040 and 042 were recorded on iOS without changing the tables. Re-apply their
 * bodies only when the live schema still has the pre-migration shape, so a
 * database that already applied them keeps per-exam prompt rows intact.
 */
export async function repairSwallowedNativeMigrations(database: SqlDatabase): Promise<void> {
  const repairPromptScope = await missingPromptExamType(database);
  const repairPlanSubject = await dailyPlanSubjectIsClosedCodeList(database);
  if (!repairPromptScope && !repairPlanSubject) return;

  await database.transaction(async (transaction) => {
    if (repairPromptScope) await transaction.execute(prepareMigrationSql(promptExamScopeSql));
    if (repairPlanSubject) await transaction.execute(prepareMigrationSql(dailyPlanBlockSubjectSql));
  }, { workload: TransactionWorkload.Maintenance });
}

async function missingPromptExamType(database: SqlDatabase): Promise<boolean> {
  const rows = await database.query<TableInfoRow>('PRAGMA table_info(prompt_definitions)');
  return !rows.some((row) => String(row.name ?? '').toLowerCase() === 'exam_type');
}

async function dailyPlanSubjectIsClosedCodeList(database: SqlDatabase): Promise<boolean> {
  const rows = await database.query<SqliteMasterRow>(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'daily_plan_blocks'`
  );
  return (rows[0]?.sql ?? '').includes('CHECK(subject IN');
}
