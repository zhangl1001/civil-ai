import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, '../web');
const server = await createServer({
  root: webRoot,
  configFile: false,
  resolve: { alias: { '@': path.join(webRoot, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

try {
  const [{ tutorMigrations }, maintenanceModule, indexedMaintenanceModule] = await Promise.all([
    server.ssrLoadModule('/src/capabilities/database/migrations/tutorMigrations.ts'),
    server.ssrLoadModule('/src/capabilities/database/adapters/sqlite/SqliteTutorDataMaintenance.ts'),
    server.ssrLoadModule('/src/capabilities/database/adapters/indexeddb/IndexedDbTutorDataMaintenance.ts')
  ]);
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  tutorMigrations.forEach((migration) => sqlite.exec(migration.sql));
  seedCycle(sqlite);

  assert.throws(
    () => sqlite.prepare("DELETE FROM questions WHERE id = 'question-1'").run(),
    /official question cannot be deleted/,
    'normal business writes must not delete official questions'
  );

  const database = sqliteAdapter(sqlite);
  const maintenance = new maintenanceModule.SqliteTutorDataMaintenance(database, {
    resolve: () => { throw new Error('No transaction context expected'); }
  });
  const changes = await maintenance.clearLearningData('cycle-1');

  assert.ok(changes >= 9, `clear should report deleted records, got ${changes}`);
  assert.equal(count(sqlite, 'projects'), 1, 'candidate project must be retained');
  assert.equal(count(sqlite, 'exam_cycles'), 1, 'exam cycle and plan must be retained');
  for (const table of [
    'question_sets',
    'questions',
    'question_source_links',
    'question_sources',
    'question_source_import_receipts',
    'question_import_drafts',
    'question_import_candidates',
    'question_import_publish_receipts',
    'question_reference_packs',
    'learning_sessions',
    'learning_threads',
    'tutor_cycle_conclusions'
  ]) {
    assert.equal(count(sqlite, table), 0, `${table} must be cleared`);
  }
  assert.equal(
    scalar(sqlite, 'SELECT allow_immutable_deletes FROM local_data_maintenance_guard WHERE singleton = 1'),
    0,
    'maintenance permission must close before commit'
  );
  assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length, 0, 'clear must preserve referential integrity');
  sqlite.close();
  await verifyIndexedDbMaintenance(indexedMaintenanceModule.IndexedDbTutorDataMaintenance);
  console.log('Local data maintenance verification passed.');
} finally {
  await server.close();
}

async function verifyIndexedDbMaintenance(Maintenance) {
  const stores = new Map(Object.entries({
    content_question_set_bundles: [{
      questionSetId: 'set-1',
      examCycleId: 'cycle-1',
      bundle: {
        questionSet: { id: 'set-1', examCycleId: 'cycle-1', sourceId: 'source-1' },
        questions: [{ id: 'question-1', sourceId: 'source-1' }]
      }
    }],
    generation_aggregates: [{ workflowId: 'workflow-1', examCycleId: 'cycle-1' }],
    learning_thread_aggregates: [],
    learning_session_facts: [],
    error_diagnoses: [],
    error_diagnosis_confirmations: [],
    agent_run_aggregates: [{ runId: 'run-1', examCycleId: 'cycle-1', idempotencyKey: 'run:key' }],
    agent_run_idempotency: [{ idempotencyKey: 'run:key', runId: 'run-1' }],
    agent_tool_receipts: [{ agentRunId: 'run-1', toolCallId: 'tool-1' }],
    mastery_tracks: [],
    mastery_snapshots: [],
    review_queue: [],
    daily_plan_aggregates: [],
    learning_evidence_aggregates: [],
    proactive_signals: [],
    learning_assets: [],
    question_sources: [{ id: 'source-1' }],
    question_source_links: [{ id: 'link-1', questionId: 'question-1', sourceId: 'source-1' }],
    question_lineages: [{ id: 'lineage-1', questionId: 'question-1', parentQuestionId: 'question-0' }],
    question_source_import_receipts: [{ id: 'source-receipt-1', sourceId: 'source-1' }],
    question_import_drafts: [{ id: 'draft-1', examCycleId: 'cycle-1' }],
    question_import_candidates: [{ id: 'candidate-1', draftId: 'draft-1' }],
    question_import_publish_receipts: [{ id: 'publish-1', draftId: 'draft-1', sourceId: 'source-1' }],
    question_reference_packs: [{ id: 'pack-1', examCycleId: 'cycle-1' }],
    tutor_cycle_conclusions: [],
    ability_calibration_snapshots: [],
    ai_invocations: [{ id: 'invocation-1', workflowId: 'workflow-1' }],
    error_diagnosis_projections: [],
    domain_outbox: [{ id: 'outbox-1' }],
    system_messages: [{ id: 'message-1' }]
  }));
  const deleted = [];
  const database = {
    getAll: async (store) => stores.get(store) || [],
    writeBatch: async (operations) => { deleted.push(...operations.filter((operation) => operation.type === 'delete')); }
  };
  const maintenance = new Maintenance(database, { stage: () => undefined });
  await maintenance.clearLearningData('cycle-1');
  const signatures = new Set(deleted.map((operation) => `${operation.store}:${JSON.stringify(operation.key)}`));
  for (const expected of [
    'content_question_set_bundles:"set-1"',
    'question_import_drafts:"draft-1"',
    'question_import_candidates:"candidate-1"',
    'question_import_publish_receipts:"publish-1"',
    'question_source_links:"link-1"',
    'question_lineages:"lineage-1"',
    'question_source_import_receipts:"source-receipt-1"',
    'question_sources:"source-1"',
    'question_reference_packs:"pack-1"',
    'agent_tool_receipts:["run-1","tool-1"]'
  ]) {
    assert.ok(signatures.has(expected), `IndexedDB clear is missing ${expected}`);
  }
}

function sqliteAdapter(sqlite) {
  const transaction = {
    query: async (sql, parameters = []) => sqlite.prepare(sql).all(...parameters),
    run: async (sql, parameters = []) => {
      const result = sqlite.prepare(sql).run(...parameters);
      return { changes: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
    }
  };
  return {
    transaction: async (work) => {
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const result = await work(transaction);
        sqlite.exec('COMMIT;');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK;');
        throw error;
      }
    }
  };
}

function seedCycle(sqlite) {
  sqlite.exec(`
    INSERT INTO metadata_packages(
      id, package_type, exam_type, region_scope, version, status, source,
      content_hash, schema_version, published_at, installed_at
    ) VALUES ('metadata-1', 'curriculum', 'civil_service', 'national', '1', 'published', 'bundled',
      '0123456789abcdef', '1', 1, 1);
    INSERT INTO curriculum_versions(
      id, metadata_package_id, exam_type, region_scope, version, content_hash, status, created_at
    ) VALUES ('curriculum-1', 'metadata-1', 'civil_service', 'national', '1',
      '0123456789abcdef', 'published', 1);
    INSERT INTO capability_nodes(
      id, curriculum_version_id, code, name, node_type, subject, module, sequence,
      score_weight, mastery_policy_json
    ) VALUES ('capability-1', 'curriculum-1', 'aptitude.judgment.weakening', '削弱论证',
      'knowledge_point', 'aptitude', '判断推理', 1, 1, '{}');
    INSERT INTO projects(id, name, status, created_at, updated_at)
      VALUES ('project-1', '测试工程', 'active', 1, 1);
    INSERT INTO exam_cycles(
      id, project_id, exam_type, exam_date, time_zone, phase, status,
      curriculum_version_id, created_at, updated_at
    ) VALUES ('cycle-1', 'project-1', 'civil_service', '2027-01-01', 'Asia/Shanghai',
      'foundation', 'active', 'curriculum-1', 1, 1);
    INSERT INTO content_metadata_releases(id, version, content_hash, status, created_at)
      VALUES ('release-1', '1', '1123456789abcdef', 'published', 1);
    INSERT INTO content_schema_versions(
      id, release_id, schema_code, document_type, version, schema_json, content_hash, status, created_at
    ) VALUES ('schema-1', 'release-1', 'question.single_choice', 'question', '1', '{}',
      '2123456789abcdef', 'published', 1);
    INSERT INTO question_template_versions(
      id, release_id, template_code, version, renderer_code, content_schema_version_id,
      config_json, content_hash, status, created_at
    ) VALUES ('template-1', 'release-1', 'single_choice', '1', 'single_choice', 'schema-1',
      '{}', '3123456789abcdef', 'published', 1);
    INSERT INTO prompt_definitions(id, prompt_code, task_type, description, status, created_at)
      VALUES ('prompt-1', 'content.generate.test', 'content_generation', '测试', 'active', 1);
    INSERT INTO prompt_versions(
      id, prompt_definition_id, version, manifest_json, sections_json,
      compatible_schema_versions_json, content_hash, status, created_at
    ) VALUES ('prompt-version-1', 'prompt-1', '1', '{}', '[]', '[]',
      '4123456789abcdef', 'published', 1);
    INSERT INTO generation_specs(
      id, exam_cycle_id, capability_node_id, content_kind, assessment_role,
      question_template_version_id, content_schema_version_id, requested_count,
      prompt_version_id, difficulty_json, constraints_json, context_snapshot_json, content_hash, created_at
    ) VALUES ('spec-1', 'cycle-1', 'capability-1', 'question_set', 'practice', 'template-1',
      'schema-1', 1, 'prompt-version-1', '{}', '{}', '{}', '5123456789abcdef', 1);
    INSERT INTO generation_workflows(
      id, exam_cycle_id, generation_spec_id, workflow_type, status, current_step,
      idempotency_key, started_at, updated_at
    ) VALUES ('workflow-1', 'cycle-1', 'spec-1', 'question_set', 'committed', 'complete',
      'workflow:1', 1, 1);
    INSERT INTO learning_threads(
      id, exam_cycle_id, primary_capability_node_id, origin_type, goal, gap_snapshot_json,
      stage, status, exit_criteria_json, started_at, created_at, updated_at
    ) VALUES ('thread-1', 'cycle-1', 'capability-1', 'diagnosis', '测试', '{}',
      'independent', 'active', '{}', 1, 1, 1);
    INSERT INTO question_sets(
      id, exam_cycle_id, capability_node_id, generation_spec_id, purpose,
      assessment_role, module, status, question_count, content_hash, learning_thread_id, created_at,
      origin_type, source_id, calibration_role
    ) VALUES ('question-set-1', 'cycle-1', 'capability-1', 'spec-1', 'practice',
      'practice', '判断推理', 'ready', 1, '6123456789abcdef', 'thread-1', 1,
      'official', 'source-1', 'anchor');
    INSERT INTO questions(
      id, question_set_id, exam_cycle_id, capability_node_id, question_template_version_id,
      sequence, difficulty, cognitive_level, purpose, assessment_role, content_json,
      correct_answer_json, quality_status, content_hash, content_schema_version_id,
      generator_workflow_id, created_at, origin_type, source_id, source_sequence,
      calibration_role, is_official
    ) VALUES ('question-1', 'question-set-1', 'cycle-1', 'capability-1', 'template-1',
      1, 0.5, 'application', 'practice', 'practice', '{}', '"A"', 'published',
      '7123456789abcdef', 'schema-1', 'workflow-1', 1, 'official', 'source-1', 1, 'anchor', 1);
    INSERT INTO question_sources(
      id, identity_hash, source_type, provider, exam_type, exam_year, province, paper_name,
      provenance_json, import_method, content_hash, source_version, status, created_at, updated_at
    ) VALUES ('source-1', '8123456789abcdef', 'official', '考试局', 'civil_service', 2025,
      '江苏', '测试真题', '{}', 'structured_file', '9123456789abcdef', '1', 'active', 1, 1);
    INSERT INTO question_source_links(
      id, question_id, source_id, source_sequence, relation_role, calibration_role, created_at
    ) VALUES ('link-1', 'question-1', 'source-1', 1, 'original', 'anchor', 1);
    INSERT INTO question_source_import_receipts(
      id, idempotency_key, source_id, payload_hash, imported_question_count, created_at
    ) VALUES ('source-receipt-1', 'source-import:1', 'source-1', 'e123456789abcdef', 1, 1);
    INSERT INTO question_import_drafts(
      id, exam_cycle_id, capability_node_id, capability_code, module, owner_session_id,
      source_type, import_method, source_metadata_json, raw_payload_hash, status, issues_json,
      idempotency_key, published_question_set_id, version, created_at, updated_at
    ) VALUES ('draft-1', 'cycle-1', 'capability-1', 'aptitude.judgment.weakening', '判断推理',
      'chat-1', 'official', 'structured_file', '{}', 'a123456789abcdef', 'published', '[]',
      'draft:1', 'question-set-1', 1, 1, 1);
    INSERT INTO question_import_candidates(
      id, draft_id, sequence, raw_json, content_json, content_hash, difficulty, status,
      issues_json, published_question_id, created_at, updated_at
    ) VALUES ('candidate-1', 'draft-1', 1, '{}', '{}', 'b123456789abcdef', 0.5,
      'published', '[]', 'question-1', 1, 1);
    INSERT INTO question_import_publish_receipts(
      id, draft_id, idempotency_key, payload_hash, question_set_id, source_id,
      published_question_count, created_at
    ) VALUES ('publish-1', 'draft-1', 'publish:1', 'c123456789abcdef',
      'question-set-1', 'source-1', 1, 1);
    INSERT INTO question_reference_packs(
      id, exam_cycle_id, capability_node_id, module, exam_scope_json, source_question_count,
      source_set_count, source_ids_json, question_type_distribution_json,
      difficulty_distribution_json, structural_distribution_json, distractor_patterns_json,
      representative_questions_json, policy_version, content_hash, created_at
    ) VALUES ('pack-1', 'cycle-1', 'capability-1', '判断推理', '{}', 1, 1, '["source-1"]',
      '{}', '{}', '{}', '[]', '[]', 'v1', 'd123456789abcdef', 1);
    INSERT INTO learning_sessions(
      id, exam_cycle_id, learning_thread_id, question_set_id, session_type, assessment_role,
      status, started_at, completed_at, elapsed_ms, question_count, answered_count, correct_count,
      idempotency_key, created_at, updated_at
    ) VALUES ('session-1', 'cycle-1', 'thread-1', 'question-set-1', 'practice', 'practice',
      'completed', 1, 2, 1, 1, 1, 1, 'session:1', 1, 2);
    INSERT INTO tutor_cycle_conclusions(
      id, exam_cycle_id, learning_thread_id, learning_session_id, question_set_id,
      capability_node_ids_json, conclusion_type, decision_scope, observation_json,
      diagnosis_json, proposal_json, execution_json, assessment_json, schedule_json,
      policy_version, idempotency_key, created_at
    ) VALUES ('conclusion-1', 'cycle-1', 'thread-1', 'session-1', 'question-set-1',
      '["capability-1"]', 'objective_session', 'single_capability', '{}', '{}', '{}', '{}',
      '{}', '{}', 'v1', 'conclusion:1', 2);
  `);
}

function count(sqlite, table) {
  return Number(scalar(sqlite, `SELECT COUNT(*) AS value FROM ${table}`));
}

function scalar(sqlite, sql) {
  return Object.values(sqlite.prepare(sql).get())[0];
}
