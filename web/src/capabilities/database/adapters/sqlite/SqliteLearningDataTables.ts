export interface SqliteLearningTable {
  readonly table: string;
  /** Selects exactly the rows clearLearningData removes; every `?` binds the exam cycle id. */
  readonly scope: string;
  /** An insert trigger on an earlier table already wrote rows here; the backup's rows replace them. */
  readonly replacesTriggerRows?: true;
  /** Shared rows are matched by id; another row holding these unique values means a different id for the same thing. */
  readonly identityColumns?: readonly string[];
}

const cycleThreads = 'SELECT id FROM learning_threads WHERE exam_cycle_id = ?';
// Child runs cascade from their parent or root even when they carry no cycle id themselves.
const cycleAgentRuns = `WITH RECURSIVE cycle_runs(id) AS (
    SELECT id FROM tutor_agent_runs WHERE exam_cycle_id = ?
    UNION
    SELECT child.id FROM tutor_agent_runs child
    JOIN cycle_runs parent ON child.parent_agent_run_id = parent.id OR child.root_agent_run_id = parent.id
  ) SELECT id FROM cycle_runs`;
const cycleWorkflows = 'SELECT id FROM generation_workflows WHERE exam_cycle_id = ?';
const cycleLectures = 'SELECT id FROM lectures WHERE exam_cycle_id = ?';
const cycleQuestionSets = 'SELECT id FROM question_sets WHERE exam_cycle_id = ?';
const cycleSetQuestions = `SELECT id FROM questions WHERE question_set_id IN (${cycleQuestionSets})`;
const cycleQuestions = 'SELECT id FROM questions WHERE exam_cycle_id = ?';
const cycleDrafts = 'SELECT id FROM question_import_drafts WHERE exam_cycle_id = ?';
const cycleTracks = 'SELECT id FROM mastery_tracks WHERE exam_cycle_id = ?';
const cycleSessions = 'SELECT id FROM learning_sessions WHERE exam_cycle_id = ?';
const cycleAttempts = `SELECT id FROM attempts WHERE session_id IN (${cycleSessions})`;
const cycleDiagnoses = `SELECT id FROM error_diagnoses WHERE exam_cycle_id = ? OR attempt_id IN (${cycleAttempts})`;
const cycleEvidence = `SELECT id FROM learning_evidence WHERE exam_cycle_id = ? OR attempt_id IN (${cycleAttempts})`;
const cyclePlans = 'SELECT id FROM daily_plans WHERE exam_cycle_id = ?';
const cycleImportSources = `SELECT link.source_id
    FROM question_source_links link
    JOIN questions question ON question.id = link.question_id
    WHERE question.exam_cycle_id = ?
    UNION
    SELECT receipt.source_id
    FROM question_import_publish_receipts receipt
    JOIN question_import_drafts draft ON draft.id = receipt.draft_id
    WHERE draft.exam_cycle_id = ?`;

/**
 * Every table clearLearningData changes for a cycle: its direct DELETEs plus
 * each ON DELETE CASCADE path into a table, so restoring these rows puts back
 * exactly what the cleanup removed. Parents come before children because the
 * insert triggers need them (questions their set, attempts their session and
 * question, evidence its attempt). Foreign keys are deferred during a restore,
 * so cycles through nullable columns (session -> review -> evidence -> attempt)
 * need no ordering. verify-data-maintenance.mjs fails the build when a table
 * the cleanup reaches is missing here.
 */
export const sqliteLearningTables: readonly SqliteLearningTable[] = [
  { table: 'learning_threads', scope: 'exam_cycle_id = ?' },
  { table: 'learning_thread_events', scope: `learning_thread_id IN (${cycleThreads})` },
  { table: 'teaching_blueprints', scope: `exam_cycle_id = ? OR learning_thread_id IN (${cycleThreads})` },
  { table: 'tutor_agent_runs', scope: `id IN (${cycleAgentRuns})` },
  { table: 'tutor_agent_run_events', scope: `agent_run_id IN (${cycleAgentRuns})` },
  { table: 'tutor_agent_invocations', scope: `agent_run_id IN (${cycleAgentRuns})` },
  { table: 'agent_tool_receipts', scope: `agent_run_id IN (${cycleAgentRuns})` },
  { table: 'generation_specs', scope: 'exam_cycle_id = ?' },
  { table: 'generation_workflows', scope: 'exam_cycle_id = ?' },
  { table: 'ai_invocations', scope: `workflow_id IN (${cycleWorkflows})` },
  { table: 'content_documents', scope: 'exam_cycle_id = ?' },
  { table: 'lectures', scope: 'exam_cycle_id = ?' },
  { table: 'question_sets', scope: 'exam_cycle_id = ?' },
  {
    table: 'lecture_question_sets',
    scope: `lecture_id IN (${cycleLectures}) OR question_set_id IN (${cycleQuestionSets})`
  },
  { table: 'questions', scope: `question_set_id IN (${cycleQuestionSets})` },
  // question_primary_capability_insert adds the primary link for every inserted question.
  { table: 'question_capabilities', scope: `question_id IN (${cycleSetQuestions})`, replacesTriggerRows: true },
  {
    table: 'question_lineage',
    scope: `question_id IN (${cycleQuestions}) OR parent_question_id IN (${cycleQuestions})`
  },
  { table: 'question_source_links', scope: `question_id IN (${cycleQuestions})` },
  { table: 'question_import_drafts', scope: 'exam_cycle_id = ?' },
  { table: 'question_import_candidates', scope: `draft_id IN (${cycleDrafts})` },
  { table: 'question_import_publish_receipts', scope: `draft_id IN (${cycleDrafts})` },
  { table: 'question_source_import_receipts', scope: `source_id IN (${cycleImportSources})` },
  { table: 'question_reference_packs', scope: 'exam_cycle_id = ?' },
  { table: 'mastery_tracks', scope: 'exam_cycle_id = ?' },
  { table: 'mastery_snapshots', scope: `mastery_track_id IN (${cycleTracks})` },
  { table: 'review_queue', scope: `exam_cycle_id = ? OR mastery_track_id IN (${cycleTracks})` },
  { table: 'learning_sessions', scope: 'exam_cycle_id = ?' },
  { table: 'question_exposures', scope: `exam_cycle_id = ? OR session_id IN (${cycleSessions})` },
  { table: 'attempts', scope: `session_id IN (${cycleSessions})` },
  { table: 'decision_observations', scope: `attempt_id IN (${cycleAttempts})` },
  { table: 'grading_results', scope: `attempt_id IN (${cycleAttempts})` },
  { table: 'error_diagnoses', scope: `exam_cycle_id = ? OR attempt_id IN (${cycleAttempts})` },
  {
    table: 'error_diagnosis_confirmations',
    scope: `exam_cycle_id = ? OR error_diagnosis_id IN (${cycleDiagnoses}) OR attempt_id IN (${cycleAttempts})`
  },
  { table: 'error_diagnosis_current_projection', scope: `error_diagnosis_id IN (${cycleDiagnoses})` },
  { table: 'learning_evidence', scope: `exam_cycle_id = ? OR attempt_id IN (${cycleAttempts})` },
  { table: 'evidence_corrections', scope: `exam_cycle_id = ? OR evidence_id IN (${cycleEvidence})` },
  { table: 'evidence_validity_projection', scope: `evidence_id IN (${cycleEvidence})` },
  { table: 'tutor_cycle_conclusions', scope: 'exam_cycle_id = ?' },
  { table: 'ability_calibration_snapshots', scope: 'exam_cycle_id = ?' },
  { table: 'daily_plans', scope: 'exam_cycle_id = ?' },
  { table: 'daily_plan_blocks', scope: `daily_plan_id IN (${cyclePlans})` },
  {
    table: 'daily_plan_items',
    scope: `daily_plan_id IN (${cyclePlans})
      OR daily_plan_block_id IN (SELECT id FROM daily_plan_blocks WHERE daily_plan_id IN (${cyclePlans}))`
  },
  { table: 'learning_progress', scope: 'exam_cycle_id = ?' },
  { table: 'proactive_signals', scope: 'exam_cycle_id = ?' },
  { table: 'learning_assets', scope: 'exam_cycle_id = ?' },
  {
    table: 'domain_outbox',
    scope: `(aggregate_type = 'learning_thread' AND aggregate_id IN (${cycleThreads}))
      OR (aggregate_type = 'tutor_agent_run' AND aggregate_id IN (SELECT id FROM tutor_agent_runs WHERE exam_cycle_id = ?))
      OR (aggregate_type = 'error_diagnosis' AND aggregate_id IN (SELECT id FROM error_diagnoses WHERE exam_cycle_id = ?))
      OR (aggregate_type = 'learning_session' AND aggregate_id IN (${cycleSessions}))
      OR (aggregate_type = 'learning_evidence' AND aggregate_id IN (SELECT id FROM learning_evidence WHERE exam_cycle_id = ?))
      OR (aggregate_type = 'generation_workflow' AND aggregate_id IN (${cycleWorkflows}))
      OR (aggregate_type = 'question_set' AND aggregate_id IN (${cycleQuestionSets}))`
  },
  {
    table: 'system_messages',
    scope: `(source_type = 'exam_cycle' AND source_id = ?)
      OR (source_type = 'agent_run' AND source_id IN (SELECT id FROM tutor_agent_runs WHERE exam_cycle_id = ?))
      OR (source_type = 'daily_plan' AND source_id IN (${cyclePlans}))
      OR (source_type = 'review_queue' AND source_id IN (SELECT id FROM review_queue WHERE exam_cycle_id = ?))
      OR (source_type = 'learning_session' AND source_id IN (${cycleSessions}))`
  }
];

/**
 * Question sources are shared by every cycle and never cleared, but a restore on
 * a fresh device needs the ones this cycle's links, receipts and sets cite.
 */
export const sqliteLearningReferences: readonly SqliteLearningTable[] = [
  {
    table: 'question_sources',
    identityColumns: ['identity_hash', 'content_hash'],
    scope: `id IN (
      ${cycleImportSources}
      UNION SELECT source_id FROM question_sets WHERE exam_cycle_id = ?
      UNION SELECT source_id FROM questions WHERE exam_cycle_id = ?
    )`
  }
];

export function scopeParameters(scope: string, examCycleId: string): readonly string[] {
  return Array.from({ length: scope.split('?').length - 1 }, () => examCycleId);
}
