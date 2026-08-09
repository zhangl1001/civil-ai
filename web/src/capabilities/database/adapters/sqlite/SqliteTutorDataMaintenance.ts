import type { ExamCycleId } from '@/kernel/public';
import type { SqlTransactionScope } from '../sqlite/SqlTransactionScope';
import type { SqlDatabase } from '../../contracts/SqlDatabase';
import { TransactionWorkload } from '../../contracts/UnitOfWork';
import type { TransactionContext } from '../../contracts/UnitOfWork';
import type { TutorDataMaintenance } from '../../contracts/TutorDataMaintenance';

interface SourceIdRow {
  readonly [column: string]: unknown;
  readonly id: string;
}

const deleteStatements = [
  { sql: 'UPDATE local_data_maintenance_guard SET allow_immutable_deletes = 1 WHERE singleton = 1', scoped: false, count: false },
  { sql: 'DELETE FROM domain_outbox', scoped: false, count: true },
  { sql: 'DELETE FROM system_messages', scoped: false, count: true },
  { sql: 'DELETE FROM tutor_cycle_conclusions WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM ability_calibration_snapshots WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM question_reference_packs WHERE exam_cycle_id = ?', scoped: true, count: true },
  {
    sql: `DELETE FROM question_import_publish_receipts
      WHERE draft_id IN (SELECT id FROM question_import_drafts WHERE exam_cycle_id = ?)`,
    scoped: true,
    count: true
  },
  {
    sql: `DELETE FROM question_import_candidates
      WHERE draft_id IN (SELECT id FROM question_import_drafts WHERE exam_cycle_id = ?)`,
    scoped: true,
    count: true
  },
  { sql: 'DELETE FROM question_import_drafts WHERE exam_cycle_id = ?', scoped: true, count: true },
  {
    sql: `DELETE FROM question_lineage
      WHERE question_id IN (SELECT id FROM questions WHERE exam_cycle_id = ?)
         OR parent_question_id IN (SELECT id FROM questions WHERE exam_cycle_id = ?)`,
    scoped: 'twice',
    count: true
  },
  {
    sql: `DELETE FROM question_source_links
      WHERE question_id IN (SELECT id FROM questions WHERE exam_cycle_id = ?)`,
    scoped: true,
    count: true
  },
  { sql: 'DELETE FROM learning_assets WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM proactive_signals WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM daily_plans WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM review_queue WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM mastery_tracks WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM learning_evidence WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM learning_sessions WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM teaching_blueprints WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM learning_threads WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM question_sets WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM lectures WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM content_documents WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM generation_workflows WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM generation_specs WHERE exam_cycle_id = ?', scoped: true, count: true },
  { sql: 'DELETE FROM tutor_agent_runs WHERE exam_cycle_id = ?', scoped: true, count: true }
] as const;

export class SqliteTutorDataMaintenance implements TutorDataMaintenance {
  constructor(
    private readonly database: SqlDatabase,
    private readonly scope: SqlTransactionScope
  ) {}

  async clearLearningData(examCycleId: ExamCycleId, context?: TransactionContext): Promise<number> {
    if (context) {
      return this.clearWithTransaction(this.scope.resolve(context), examCycleId);
    }
    return this.database.transaction(async (transaction) => {
      return this.clearWithTransaction(transaction, examCycleId);
    }, { workload: TransactionWorkload.Maintenance });
  }

  private async clearWithTransaction(
    transaction: Pick<SqlDatabase, 'query' | 'run'>,
    examCycleId: ExamCycleId
  ): Promise<number> {
    const sourceIds = (await transaction.query<SourceIdRow>(
      `SELECT DISTINCT source_id AS id
       FROM question_source_links
       WHERE question_id IN (SELECT id FROM questions WHERE exam_cycle_id = ?)
       UNION
       SELECT DISTINCT receipt.source_id AS id
       FROM question_import_publish_receipts receipt
       JOIN question_import_drafts draft ON draft.id = receipt.draft_id
       WHERE draft.exam_cycle_id = ?`,
      [examCycleId, examCycleId]
    )).map((row) => row.id).filter(Boolean);
    let changes = 0;
    for (const statement of deleteStatements) {
      const parameters = statement.scoped === 'twice'
        ? [examCycleId, examCycleId]
        : statement.scoped
          ? [examCycleId]
          : [];
      const result = await transaction.run(statement.sql, parameters);
      if (statement.count) changes += result.changes;
    }
    for (const sourceIdChunk of chunks(sourceIds, 200)) {
      const placeholders = sourceIdChunk.map(() => '?').join(', ');
      changes += (await transaction.run(
        `DELETE FROM question_source_import_receipts
         WHERE question_source_import_receipts.source_id IN (${placeholders})
           AND NOT EXISTS (
             SELECT 1 FROM question_source_links link
             WHERE link.source_id = question_source_import_receipts.source_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM question_import_publish_receipts receipt
             WHERE receipt.source_id = question_source_import_receipts.source_id
           )`,
        sourceIdChunk
      )).changes;
      changes += (await transaction.run(
        `DELETE FROM question_sources
         WHERE id IN (${placeholders})
           AND NOT EXISTS (SELECT 1 FROM question_source_links link WHERE link.source_id = question_sources.id)
           AND NOT EXISTS (SELECT 1 FROM question_import_publish_receipts receipt WHERE receipt.source_id = question_sources.id)
           AND NOT EXISTS (SELECT 1 FROM questions question WHERE question.source_id = question_sources.id)
           AND NOT EXISTS (SELECT 1 FROM question_sets question_set WHERE question_set.source_id = question_sources.id)`,
        sourceIdChunk
      )).changes;
    }
    await transaction.run(
      'UPDATE local_data_maintenance_guard SET allow_immutable_deletes = 0 WHERE singleton = 1'
    );
    return changes;
  }

}

function chunks<Value>(values: readonly Value[], size: number): readonly Value[][] {
  const result: Value[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
