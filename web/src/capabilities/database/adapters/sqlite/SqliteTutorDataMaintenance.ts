import type { ExamCycleId } from '@/kernel/public';
import type { SqlTransactionScope } from '../sqlite/SqlTransactionScope';
import type { SqlDatabase } from '../../contracts/SqlDatabase';
import { TransactionWorkload } from '../../contracts/UnitOfWork';
import type { TransactionContext } from '../../contracts/UnitOfWork';
import type { TutorDataMaintenance } from '../../contracts/TutorDataMaintenance';

const deleteStatements = [
  { sql: 'DELETE FROM domain_outbox', scoped: false },
  { sql: 'DELETE FROM system_messages', scoped: false },
  { sql: 'DELETE FROM learning_assets WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM proactive_signals WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM daily_plans WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM review_queue WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM mastery_tracks WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM learning_evidence WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM ability_calibration_snapshots WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM tutor_cycle_conclusions WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM learning_sessions WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM tutor_agent_runs WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM teaching_blueprints WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM learning_threads WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM question_sets WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM lectures WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM content_documents WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM generation_workflows WHERE exam_cycle_id = ?', scoped: true },
  { sql: 'DELETE FROM generation_specs WHERE exam_cycle_id = ?', scoped: true }
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
    transaction: Pick<SqlDatabase, 'run'>,
    examCycleId: ExamCycleId
  ): Promise<number> {
    let changes = 0;
    for (const statement of deleteStatements) {
      changes += (await transaction.run(statement.sql, statement.scoped ? [examCycleId] : [])).changes;
    }
    return changes;
  }

}
