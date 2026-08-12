import type { ExamCycleId } from '@/kernel/public';
import type { SqlTransactionScope } from '../sqlite/SqlTransactionScope';
import type { SqlDatabase } from '../../contracts/SqlDatabase';
import { TransactionWorkload } from '../../contracts/UnitOfWork';
import type { TransactionContext } from '../../contracts/UnitOfWork';
import type { TutorDataMaintenance } from '../../contracts/TutorDataMaintenance';

interface MaintenanceStatement {
  readonly sql: string;
  readonly parameters: (examCycleId: ExamCycleId) => readonly string[];
  readonly countChanges?: boolean;
}

const noParameters = (): readonly string[] => [];
const cycleParameter = (examCycleId: ExamCycleId): readonly string[] => [examCycleId];
const cycleParameterTwice = (examCycleId: ExamCycleId): readonly string[] => [examCycleId, examCycleId];
const repeatedCycleParameter = (count: number) => (examCycleId: ExamCycleId): readonly string[] => (
  Array.from({ length: count }, () => examCycleId)
);

// Keep this child-to-parent order aligned with the SQLite foreign-key graph.
const maintenanceStatements: readonly MaintenanceStatement[] = [
  {
    sql: "DELETE FROM data_maintenance_context WHERE operation = 'clear_learning_data'",
    parameters: noParameters,
    countChanges: false
  },
  {
    sql: "INSERT INTO data_maintenance_context(operation, enabled) VALUES ('clear_learning_data', 1)",
    parameters: noParameters,
    countChanges: false
  },
  {
    sql: `DELETE FROM domain_outbox WHERE
      (aggregate_type = 'learning_thread' AND aggregate_id IN (
        SELECT id FROM learning_threads WHERE exam_cycle_id = ?
      )) OR
      (aggregate_type = 'tutor_agent_run' AND aggregate_id IN (
        SELECT id FROM tutor_agent_runs WHERE exam_cycle_id = ?
      )) OR
      (aggregate_type = 'error_diagnosis' AND aggregate_id IN (
        SELECT id FROM error_diagnoses WHERE exam_cycle_id = ?
      )) OR
      (aggregate_type = 'learning_session' AND aggregate_id IN (
        SELECT id FROM learning_sessions WHERE exam_cycle_id = ?
      )) OR
      (aggregate_type = 'learning_evidence' AND aggregate_id IN (
        SELECT id FROM learning_evidence WHERE exam_cycle_id = ?
      )) OR
      (aggregate_type = 'generation_workflow' AND aggregate_id IN (
        SELECT id FROM generation_workflows WHERE exam_cycle_id = ?
      )) OR
      (aggregate_type = 'question_set' AND aggregate_id IN (
        SELECT id FROM question_sets WHERE exam_cycle_id = ?
      ))`,
    parameters: repeatedCycleParameter(7)
  },
  {
    sql: `DELETE FROM system_messages WHERE
      (source_type = 'exam_cycle' AND source_id = ?) OR
      (source_type = 'agent_run' AND source_id IN (
        SELECT id FROM tutor_agent_runs WHERE exam_cycle_id = ?
      )) OR
      (source_type = 'daily_plan' AND source_id IN (
        SELECT id FROM daily_plans WHERE exam_cycle_id = ?
      )) OR
      (source_type = 'review_queue' AND source_id IN (
        SELECT id FROM review_queue WHERE exam_cycle_id = ?
      )) OR
      (source_type = 'learning_session' AND source_id IN (
        SELECT id FROM learning_sessions WHERE exam_cycle_id = ?
      ))`,
    parameters: repeatedCycleParameter(5)
  },
  {
    sql: `DELETE FROM question_source_import_receipts
      WHERE source_id IN (
        SELECT link.source_id
        FROM question_source_links link
        JOIN questions question ON question.id = link.question_id
        WHERE question.exam_cycle_id = ?
        UNION
        SELECT receipt.source_id
        FROM question_import_publish_receipts receipt
        JOIN question_import_drafts draft ON draft.id = receipt.draft_id
        WHERE draft.exam_cycle_id = ?
      )`,
    parameters: cycleParameterTwice
  },
  {
    sql: `DELETE FROM question_import_publish_receipts
      WHERE draft_id IN (SELECT id FROM question_import_drafts WHERE exam_cycle_id = ?)`,
    parameters: cycleParameter
  },
  {
    sql: `DELETE FROM question_import_candidates
      WHERE draft_id IN (SELECT id FROM question_import_drafts WHERE exam_cycle_id = ?)`,
    parameters: cycleParameter
  },
  {
    sql: `DELETE FROM question_source_links
      WHERE question_id IN (SELECT id FROM questions WHERE exam_cycle_id = ?)`,
    parameters: cycleParameter
  },
  {
    sql: `DELETE FROM question_lineage
      WHERE question_id IN (SELECT id FROM questions WHERE exam_cycle_id = ?)
         OR parent_question_id IN (SELECT id FROM questions WHERE exam_cycle_id = ?)`,
    parameters: cycleParameterTwice
  },
  { sql: 'DELETE FROM question_import_drafts WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM question_reference_packs WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM tutor_cycle_conclusions WHERE exam_cycle_id = ?', parameters: cycleParameter },
  {
    sql: `DELETE FROM error_diagnosis_current_projection
      WHERE error_diagnosis_id IN (SELECT id FROM error_diagnoses WHERE exam_cycle_id = ?)`,
    parameters: cycleParameter
  },
  { sql: 'DELETE FROM error_diagnosis_confirmations WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM error_diagnoses WHERE exam_cycle_id = ?', parameters: cycleParameter },
  {
    sql: `DELETE FROM evidence_validity_projection
      WHERE evidence_id IN (SELECT id FROM learning_evidence WHERE exam_cycle_id = ?)`,
    parameters: cycleParameter
  },
  { sql: 'DELETE FROM evidence_corrections WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM learning_evidence WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM question_exposures WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM learning_sessions WHERE exam_cycle_id = ?', parameters: cycleParameter },
  {
    sql: 'UPDATE daily_plans SET supersedes_plan_id = NULL WHERE exam_cycle_id = ?',
    parameters: cycleParameter,
    countChanges: false
  },
  { sql: 'DELETE FROM daily_plans WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM review_queue WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM mastery_tracks WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM ability_calibration_snapshots WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM proactive_signals WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM learning_assets WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM tutor_agent_runs WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM lectures WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM question_sets WHERE exam_cycle_id = ?', parameters: cycleParameter },
  {
    sql: 'UPDATE content_documents SET supersedes_document_id = NULL WHERE exam_cycle_id = ?',
    parameters: cycleParameter,
    countChanges: false
  },
  { sql: 'DELETE FROM content_documents WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM generation_workflows WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM generation_specs WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM teaching_blueprints WHERE exam_cycle_id = ?', parameters: cycleParameter },
  { sql: 'DELETE FROM learning_threads WHERE exam_cycle_id = ?', parameters: cycleParameter },
  {
    sql: "DELETE FROM data_maintenance_context WHERE operation = 'clear_learning_data'",
    parameters: noParameters,
    countChanges: false
  }
];

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
    for (const statement of maintenanceStatements) {
      const result = await transaction.run(statement.sql, statement.parameters(examCycleId));
      if (statement.countChanges !== false) changes += result.changes;
    }
    return changes;
  }

}
