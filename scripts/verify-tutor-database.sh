#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
foundation_schema_file="$project_root/web/src/capabilities/database/migrations/001_foundation.sql"
content_schema_file="$project_root/web/src/capabilities/database/migrations/002_content_ai_foundation.sql"
learning_evidence_schema_file="$project_root/web/src/capabilities/database/migrations/003_learning_evidence.sql"
error_diagnosis_confirmation_schema_file="$project_root/web/src/capabilities/database/migrations/004_error_diagnosis_confirmations.sql"
tutor_agent_runtime_schema_file="$project_root/web/src/capabilities/database/migrations/005_tutor_agent_runtime.sql"
mastery_planning_schema_file="$project_root/web/src/capabilities/database/migrations/006_mastery_planning_foundation.sql"
review_execution_schema_file="$project_root/web/src/capabilities/database/migrations/007_review_execution_linkage.sql"
task_message_center_schema_file="$project_root/web/src/capabilities/database/migrations/008_task_message_center.sql"
proactive_signals_schema_file="$project_root/web/src/capabilities/database/migrations/009_plan_feedback_proactive_signals.sql"
learning_assets_schema_file="$project_root/web/src/capabilities/database/migrations/010_learning_assets.sql"
conversations_schema_file="$project_root/web/src/capabilities/database/migrations/011_conversations.sql"
learning_asset_indexes_schema_file="$project_root/web/src/capabilities/database/migrations/012_learning_asset_and_session_indexes.sql"
agent_run_target_index_schema_file="$project_root/web/src/capabilities/database/migrations/013_agent_run_target_index.sql"
conversation_message_logs_schema_file="$project_root/web/src/capabilities/database/migrations/014_conversation_message_logs.sql"
conversation_session_index_schema_file="$project_root/web/src/capabilities/database/migrations/015_conversation_session_index.sql"
agent_workspace_sessions_schema_file="$project_root/web/src/capabilities/database/migrations/016_agent_workspace_sessions.sql"
practice_session_drafts_schema_file="$project_root/web/src/capabilities/database/migrations/017_practice_session_drafts.sql"
agent_work_pools_schema_file="$project_root/web/src/capabilities/database/migrations/018_agent_work_pools.sql"
practice_manifests_schema_file="$project_root/web/src/capabilities/database/migrations/019_practice_manifests.sql"
error_diagnosis_guidance_schema_file="$project_root/web/src/capabilities/database/migrations/020_error_diagnosis_guidance.sql"
question_set_practice_status_schema_file="$project_root/web/src/capabilities/database/migrations/021_question_set_practice_status.sql"
question_source_foundation_schema_file="$project_root/web/src/capabilities/database/migrations/022_question_source_foundation.sql"
question_import_drafts_schema_file="$project_root/web/src/capabilities/database/migrations/023_question_import_drafts.sql"
true_question_reference_packs_schema_file="$project_root/web/src/capabilities/database/migrations/024_true_question_reference_packs.sql"
tutor_cycle_conclusions_schema_file="$project_root/web/src/capabilities/database/migrations/025_tutor_cycle_conclusions.sql"
ability_calibration_snapshots_schema_file="$project_root/web/src/capabilities/database/migrations/026_ability_calibration_snapshots.sql"
web_research_import_method_schema_file="$project_root/web/src/capabilities/database/migrations/027_web_research_import_method.sql"
reference_pack_comparison_questions_schema_file="$project_root/web/src/capabilities/database/migrations/028_reference_pack_comparison_questions.sql"
database_file="$(mktemp "${TMPDIR:-/tmp}/zhangl-tutor-schema.XXXXXX.sqlite")"

cleanup() {
  rm -f "$database_file"
}
trap cleanup EXIT

sqlite3 "$database_file" <<SQL
.bail on
PRAGMA foreign_keys = ON;
.read $foundation_schema_file
.read $content_schema_file
.read $learning_evidence_schema_file
.read $error_diagnosis_confirmation_schema_file
.read $tutor_agent_runtime_schema_file
.read $mastery_planning_schema_file
.read $review_execution_schema_file
.read $task_message_center_schema_file
.read $proactive_signals_schema_file
.read $learning_assets_schema_file
.read $conversations_schema_file
.read $learning_asset_indexes_schema_file
.read $agent_run_target_index_schema_file
.read $conversation_message_logs_schema_file
.read $conversation_session_index_schema_file
.read $agent_workspace_sessions_schema_file
.read $practice_session_drafts_schema_file
.read $agent_work_pools_schema_file
.read $practice_manifests_schema_file
.read $error_diagnosis_guidance_schema_file
.read $question_set_practice_status_schema_file
.read $question_source_foundation_schema_file
.read $question_import_drafts_schema_file
.read $true_question_reference_packs_schema_file
.read $tutor_cycle_conclusions_schema_file
.read $ability_calibration_snapshots_schema_file

INSERT INTO metadata_packages(
  id, package_type, exam_type, region_scope, version, status, source,
  content_hash, schema_version, published_at, installed_at
) VALUES (
  'metadata-1', 'curriculum', 'civil_service', 'national', '1.0.0', 'published', 'bundled',
  '0123456789abcdef', '1', 1000, 1000
);

INSERT INTO curriculum_versions(
  id, metadata_package_id, exam_type, region_scope, version, content_hash, status, created_at
) VALUES (
  'curriculum-1', 'metadata-1', 'civil_service', 'national', '1.0.0',
  '0123456789abcdef', 'published', 1000
);

INSERT INTO capability_nodes(
  id, curriculum_version_id, code, name, node_type, subject, module,
  sequence, score_weight, mastery_policy_json
) VALUES (
  'capability-1', 'curriculum-1', 'aptitude.judgment.weakening', '削弱论证',
  'knowledge_point', 'aptitude', '判断推理', 1, 1, '{}'
);

INSERT INTO projects(id, name, status, created_at, updated_at)
VALUES ('project-1', '测试考生', 'active', 1000, 1000);

INSERT INTO exam_cycles(
  id, project_id, exam_type, exam_date, time_zone, phase, status,
  curriculum_version_id, created_at, updated_at
) VALUES (
  'cycle-1', 'project-1', 'civil_service', '2027-01-01', 'Asia/Shanghai',
  'foundation', 'active', 'curriculum-1', 1000, 1000
);

INSERT INTO score_targets(
  id, exam_cycle_id, subject, target_score, max_score, source, status, effective_from, created_at
) VALUES ('target-1', 'cycle-1', 'aptitude', 80, 100, 'candidate', 'active', 1000, 1000);

INSERT INTO score_measurements(
  id, exam_cycle_id, subject, score, max_score, measurement_type, source,
  measured_at, confidence, created_at
) VALUES ('measurement-1', 'cycle-1', 'aptitude', 50, 100, 'self_report', 'candidate', 1000, 0.4, 1000);

INSERT INTO domain_outbox(
  id, aggregate_type, aggregate_id, event_type, payload_json, occurred_at, idempotency_key
) VALUES ('event-1', 'exam_cycle', 'cycle-1', 'exam_cycle.created', '{}', 1000, 'cycle-1:created');

INSERT INTO command_receipts(
  idempotency_key, command_type, result_resource_type, result_resource_id, completed_at
) VALUES ('create-cycle:1', 'candidate.create_cycle', 'exam_cycle', 'cycle-1', 1000);

INSERT INTO content_metadata_releases(id, version, content_hash, status, created_at)
VALUES ('content-release-v1', '1.0.0', '0123456789abcdef', 'published', 1000);

INSERT INTO content_schema_versions(
  id, release_id, schema_code, document_type, version, schema_json, content_hash, status, created_at
) VALUES (
  'schema-question-v1', 'content-release-v1', 'question.single_choice', 'question', '1.0.0', '{}',
  '0123456789abcdef', 'published', 1000
);

INSERT INTO question_template_versions(
  id, release_id, template_code, version, renderer_code, content_schema_version_id,
  config_json, content_hash, status, created_at
) VALUES (
  'template-single-v1', 'content-release-v1', 'single_choice', '1.0.0', 'single_choice', 'schema-question-v1',
  '{}', '0123456789abcdef', 'published', 1000
);

INSERT INTO prompt_definitions(id, prompt_code, task_type, description, status, created_at)
VALUES ('prompt-question', 'question.generate.weakening', 'content_generation', '生成削弱论证题', 'active', 1000);

INSERT INTO prompt_versions(
  id, prompt_definition_id, version, manifest_json, sections_json,
  compatible_schema_versions_json, content_hash, status, created_at
) VALUES (
  'prompt-question-v1', 'prompt-question', '1.0.0', '{}', '[]', '["question.single_choice.v1"]',
  '0123456789abcdef', 'published', 1000
);

INSERT INTO prompt_definitions(id, prompt_code, task_type, description, status, created_at)
VALUES ('prompt-question-reinstall', 'question.generate.weakening', 'content_generation', '生成削弱论证题新版', 'active', 1100)
ON CONFLICT(prompt_code) DO UPDATE SET
  task_type = excluded.task_type,
  description = excluded.description,
  status = 'active';

INSERT INTO prompt_versions(
  id, prompt_definition_id, version, manifest_json, sections_json,
  compatible_schema_versions_json, content_hash, status, created_at
) VALUES (
  'prompt-question-v2',
  (SELECT id FROM prompt_definitions WHERE prompt_code = 'question.generate.weakening'),
  '1.1.0', '{}', '[]', '["question.single_choice.v1"]',
  '1123456789abcdef', 'published', 1100
);

INSERT INTO generation_specs(
  id, exam_cycle_id, capability_node_id, content_kind, assessment_role,
  question_template_version_id, content_schema_version_id, requested_count,
  prompt_version_id, difficulty_json, constraints_json, context_snapshot_json, content_hash, created_at
) VALUES (
  'spec-1', 'cycle-1', 'capability-1', 'question_set', 'practice',
  'template-single-v1', 'schema-question-v1', 1, 'prompt-question-v1', '{}', '{}', '{}',
  '0123456789abcdef', 1000
);

INSERT INTO generation_workflows(
  id, exam_cycle_id, generation_spec_id, workflow_type, status, current_step,
  idempotency_key, started_at, updated_at
) VALUES (
  'workflow-1', 'cycle-1', 'spec-1', 'question_set', 'committed', 'complete',
  'workflow:test-1', 1000, 1000
);

INSERT INTO question_sets(
  id, exam_cycle_id, capability_node_id, generation_spec_id, purpose,
  assessment_role, module, status, question_count, content_hash, created_at
) VALUES (
  'question-set-1', 'cycle-1', 'capability-1', 'spec-1', 'practice',
  'practice', '判断推理', 'ready', 1, '0123456789abcdef', 1000
);

INSERT INTO questions(
  id, question_set_id, exam_cycle_id, capability_node_id, question_template_version_id,
  sequence, difficulty, cognitive_level, purpose, assessment_role, content_json,
  correct_answer_json, quality_status, content_hash, content_schema_version_id,
  generator_workflow_id, created_at
) VALUES (
  'question-1', 'question-set-1', 'cycle-1', 'capability-1', 'template-single-v1',
  1, 0.5, 'application', 'practice', 'practice', '{}', '"B"', 'published',
  '0123456789abcdef', 'schema-question-v1', 'workflow-1', 1000
);

INSERT INTO ai_invocations(
  id, workflow_id, provider, model, model_role, prompt_version_id,
  content_schema_version_id, request_hash, provider_request_id,
  input_tokens, output_tokens, latency_ms, finish_reason, validation_status, created_at
) VALUES (
  'invocation-1', 'workflow-1', 'anthropic', 'test-model', 'content_generation',
  'prompt-question-v1', 'schema-question-v1', '0123456789abcdef', 'provider-request-1',
  120, 240, 1500, 'end_turn', 'valid', 1000
);

INSERT INTO learning_threads(
  id, exam_cycle_id, primary_capability_node_id, origin_type, goal, gap_snapshot_json,
  stage, status, exit_criteria_json, started_at, created_at, updated_at
) VALUES (
  'thread-1', 'cycle-1', 'capability-1', 'diagnosis', '掌握削弱论证的结构识别与力度比较', '{}',
  'independent', 'active', '{"minimumIndependentAttempts":3}', 1100, 1100, 1100
);

INSERT INTO learning_thread_events(
  id, learning_thread_id, exam_cycle_id, event_type, reason_code, occurred_at, idempotency_key
) VALUES ('thread-event-1', 'thread-1', 'cycle-1', 'created', 'diagnosis.weakness_found', 1100, 'thread-1:created');

INSERT INTO teaching_blueprints(
  id, exam_cycle_id, learning_thread_id, capability_node_id, objective,
  prerequisite_snapshot_json, teaching_strategy, difficulty_path_json,
  version, status, created_by, created_at
) VALUES (
  'blueprint-1', 'cycle-1', 'thread-1', 'capability-1', '识别论证链并比较削弱力度',
  '{}', 'explain_then_independent', '[0.3,0.5,0.7]', 1, 'active', 'system', 1100
);

INSERT INTO learning_sessions(
  id, exam_cycle_id, learning_thread_id, question_set_id, session_type, assessment_role,
  status, started_at, completed_at, elapsed_ms, question_count, answered_count, correct_count,
  idempotency_key, created_at, updated_at
) VALUES (
  'session-1', 'cycle-1', 'thread-1', 'question-set-1', 'practice', 'practice',
  'completed', 1200, 1500, 300, 1, 1, 0, 'session:submit:1', 1200, 1500
);

INSERT INTO question_exposures(
  id, exam_cycle_id, learning_thread_id, session_id, question_id, exposure_type,
  answer_exposed, occurred_at, idempotency_key
) VALUES ('exposure-1', 'cycle-1', 'thread-1', 'session-1', 'question-1', 'practice', 0, 1200, 'session-1:question-1:practice');

INSERT INTO attempts(
  id, session_id, question_id, exam_cycle_id, capability_node_id, learning_thread_id,
  assessment_role, question_content_version, answer_json, result, score, elapsed_ms,
  confidence, hint_level, answer_change_count, submitted_at, idempotency_key
) VALUES (
  'attempt-1', 'session-1', 'question-1', 'cycle-1', 'capability-1', 'thread-1',
  'practice', 1, '{"optionId":"A"}', 'incorrect', 0, 300, 0.6, 0, 1, 1500, 'attempt:session-1:question-1'
);

INSERT INTO grading_results(
  id, attempt_id, grading_method, grader_version, result, score,
  normalized_feedback_json, confidence, confirmation_status, created_at, idempotency_key
) VALUES (
  'grading-1', 'attempt-1', 'deterministic', 'objective-single-choice:v1', 'incorrect', 0,
  '{}', 1, 'not_required', 1500, 'grading:attempt-1:deterministic:v1'
);

INSERT INTO error_diagnoses(
  id, grading_result_id, attempt_id, exam_cycle_id, capability_node_id, cause_code,
  detail, confidence, confirmation_status, recommended_action_code, source, created_at, idempotency_key
) VALUES (
  'diagnosis-1', 'grading-1', 'attempt-1', 'cycle-1', 'capability-1', 'unknown',
  '客观判分只能确认答案错误，具体思考错因等待进一步诊断。', 0.2, 'pending',
  'request_error_diagnosis', 'deterministic', 1500, 'diagnosis:attempt-1:initial'
);

INSERT INTO learning_evidence(
  id, exam_cycle_id, capability_node_id, attempt_id, assessment_role, evidence_type,
  value, weight, quality, source, validation_policy_version, occurred_at, idempotency_key
) VALUES (
  'evidence-1', 'cycle-1', 'capability-1', 'attempt-1', 'practice', 'correctness',
  0, 0.6, 1, 'deterministic_grader', 'aptitude-objective:v1', 1500, 'evidence:attempt-1:correctness'
);

INSERT INTO evidence_validity_projection(evidence_id, validity_status, updated_at, version)
VALUES ('evidence-1', 'valid', 1500, 1);

INSERT INTO learning_assets(
  id, exam_cycle_id, kind, business_key, title, status, payload_json,
  version, created_at, updated_at
) VALUES (
  'asset-profile-1', 'cycle-1', 'profile_insight', 'profile:latest',
  '能力洞察', 'ready', '{}', 1, 1600, 1600
);

INSERT INTO learning_assets(
  id, exam_cycle_id, kind, business_key, title, status, payload_json,
  version, created_at, updated_at
) VALUES (
  'asset-practice-draft-1', 'cycle-1', 'practice_session_draft', 'question-set:question-set-1',
  '答题进度', 'draft', '{"version":1,"answers":{"question-1":"A"}}', 1, 1700, 1700
);

INSERT INTO question_sources(
  id, identity_hash, source_type, provider, exam_type, exam_year, province,
  paper_name, provenance_json, import_method, content_hash, source_version,
  status, created_at, updated_at
) VALUES (
  'source-1', 'source-identity-0123456789abcdef', 'official', '测试考试局',
  'civil_service', 2025, '江苏', '测试真题', '{}', 'structured_file',
  'source-content-0123456789abcdef', '1', 'active', 1800, 1800
);

INSERT INTO question_source_links(
  id, question_id, source_id, source_sequence, relation_role, calibration_role, created_at
) VALUES ('source-link-1', 'question-1', 'source-1', 1, 'original', 'anchor', 1800);

INSERT INTO question_source_import_receipts(
  id, idempotency_key, source_id, payload_hash, imported_question_count, created_at
) VALUES ('source-receipt-1', 'source-import:1', 'source-1', 'payload-hash-0123456789abcdef', 1, 1800);

INSERT INTO question_import_drafts(
  id, exam_cycle_id, capability_node_id, capability_code, module, owner_session_id,
  source_type, import_method, source_metadata_json, raw_payload_hash, status,
  issues_json, idempotency_key, published_question_set_id, version, created_at, updated_at
) VALUES (
  'import-draft-1', 'cycle-1', 'capability-1', 'aptitude.judgment.weakening',
  '判断推理', 'chat-session-1', 'official', 'structured_file', '{}',
  'draft-payload-0123456789abcdef', 'published', '[]', 'draft:1',
  'question-set-1', 1, 1800, 1800
);

INSERT INTO question_import_candidates(
  id, draft_id, sequence, raw_json, content_json, content_hash, difficulty,
  status, issues_json, published_question_id, created_at, updated_at
) VALUES (
  'import-candidate-1', 'import-draft-1', 1, '{}', '{}',
  'candidate-content-0123456789abcdef', 0.5, 'published', '[]',
  'question-1', 1800, 1800
);

INSERT INTO question_import_publish_receipts(
  id, draft_id, idempotency_key, payload_hash, question_set_id, source_id,
  published_question_count, created_at
) VALUES (
  'publish-receipt-1', 'import-draft-1', 'publish:1',
  'publish-payload-0123456789abcdef', 'question-set-1', 'source-1', 1, 1800
);

INSERT INTO question_reference_packs(
  id, exam_cycle_id, capability_node_id, module, exam_scope_json,
  source_question_count, source_set_count, source_ids_json,
  question_type_distribution_json, difficulty_distribution_json,
  structural_distribution_json, distractor_patterns_json,
  representative_questions_json, policy_version, content_hash, created_at
) VALUES (
  'reference-pack-1', 'cycle-1', 'capability-1', '判断推理', '{}', 1, 1,
  '["source-1"]', '{}', '{}', '{}', '[]', '[]',
  'true-question-reference.v1', 'reference-pack-0123456789abcdef', 1800
);

.read $web_research_import_method_schema_file
.read $reference_pack_comparison_questions_schema_file

PRAGMA foreign_key_check;
PRAGMA integrity_check;
SQL

expect_count() {
  local query="$1"
  local expected="$2"
  local label="$3"
  local actual
  actual="$(sqlite3 "$database_file" "$query")"
  if [[ "$actual" != "$expected" ]]; then
    printf 'Expected %s to be %s, got %s\n' "$label" "$expected" "$actual" >&2
    exit 1
  fi
}

expect_count "SELECT COUNT(*) FROM projects;" "1" "project count"
expect_count "SELECT COUNT(*) FROM exam_cycles WHERE status = 'active';" "1" "active cycle count"
expect_count "SELECT COUNT(*) FROM domain_outbox WHERE published_at IS NULL;" "1" "pending outbox count"
expect_count "SELECT COUNT(*) FROM question_capabilities WHERE question_id = 'question-1' AND relation_role = 'primary';" "1" "automatic primary question capability"
expect_count "SELECT COUNT(*) FROM ai_invocations WHERE workflow_id = 'workflow-1' AND validation_status = 'valid';" "1" "AI invocation ledger"
expect_count "SELECT COUNT(*) FROM learning_threads WHERE status = 'active';" "1" "active learning thread"
expect_count "SELECT COUNT(*) FROM attempts WHERE result = 'incorrect';" "1" "objective attempt"
expect_count "SELECT COUNT(*) FROM learning_evidence evidence JOIN evidence_validity_projection validity ON validity.evidence_id = evidence.id WHERE validity.validity_status = 'valid';" "1" "valid learning evidence"
expect_count "SELECT COUNT(*) FROM tutor_agent_runs;" "0" "empty tutor agent runtime"
expect_count "SELECT COUNT(*) FROM mastery_tracks;" "0" "empty mastery projection"
expect_count "SELECT COUNT(*) FROM learning_assets WHERE kind = 'profile_insight';" "1" "profile insight asset"
expect_count "SELECT COUNT(*) FROM learning_assets WHERE kind = 'practice_session_draft' AND status = 'draft';" "1" "practice session draft"
expect_count "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'learning_sessions_question_set_idx';" "1" "question set session index"
expect_count "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'tutor_agent_runs_target_status_idx';" "1" "agent run target index"
expect_count "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('conversation_sessions', 'conversation_messages');" "0" "conversation tables excluded from business database"
expect_count "SELECT COUNT(*) FROM question_sources WHERE id = 'source-1' AND import_method = 'structured_file';" "1" "question source retained after enum migration"
expect_count "SELECT COUNT(*) FROM question_source_links WHERE id = 'source-link-1';" "1" "question source link retained after enum migration"
expect_count "SELECT COUNT(*) FROM question_import_drafts WHERE id = 'import-draft-1' AND status = 'published';" "1" "published import draft retained after enum migration"
expect_count "SELECT COUNT(*) FROM question_import_candidates WHERE id = 'import-candidate-1' AND status = 'published';" "1" "published import candidate retained after enum migration"
expect_count "SELECT COUNT(*) FROM question_import_publish_receipts WHERE id = 'publish-receipt-1';" "1" "publish receipt retained after enum migration"
expect_count "SELECT COUNT(*) FROM pragma_table_info('question_reference_packs') WHERE name = 'comparison_questions_json';" "1" "reference pack comparison column"

expect_constraint_failure() {
  local statement="$1"
  if sqlite3 "$database_file" "PRAGMA foreign_keys=ON; $statement" >/dev/null 2>&1; then
    printf 'Expected constraint failure but statement succeeded: %s\n' "$statement" >&2
    exit 1
  fi
}

expect_constraint_failure "INSERT INTO exam_cycles(id, project_id, exam_type, exam_date, time_zone, phase, status, curriculum_version_id, created_at, updated_at) VALUES ('cycle-2', 'project-1', 'civil_service', '2027-01-01', 'Asia/Shanghai', 'foundation', 'active', 'curriculum-1', 1000, 1000);"
expect_constraint_failure "INSERT INTO projects(id, name, status, created_at, updated_at) VALUES ('project-2', '另一考生', 'active', 1000, 1000);"
expect_constraint_failure "INSERT INTO score_measurements(id, exam_cycle_id, subject, score, max_score, measurement_type, source, measured_at, confidence, created_at) VALUES ('bad-score', 'cycle-1', 'aptitude', 120, 100, 'self_report', 'candidate', 1000, 0.4, 1000);"
expect_constraint_failure "INSERT INTO domain_outbox(id, aggregate_type, aggregate_id, event_type, payload_json, occurred_at, idempotency_key) VALUES ('event-2', 'exam_cycle', 'cycle-1', 'exam_cycle.created', '{}', 1000, 'cycle-1:created');"
expect_constraint_failure "INSERT INTO command_receipts(idempotency_key, command_type, result_resource_type, result_resource_id, completed_at) VALUES ('create-cycle:1', 'candidate.create_cycle', 'exam_cycle', 'cycle-2', 1000);"
expect_constraint_failure "INSERT INTO questions(id, question_set_id, exam_cycle_id, capability_node_id, question_template_version_id, sequence, difficulty, cognitive_level, purpose, assessment_role, content_json, correct_answer_json, quality_status, content_hash, content_schema_version_id, generator_workflow_id, created_at) VALUES ('question-duplicate', 'question-set-1', 'cycle-1', 'capability-1', 'template-single-v1', 1, 0.5, 'application', 'practice', 'practice', '{}', '\"A\"', 'published', '0123456789abcdef', 'schema-question-v1', 'workflow-1', 1000);"
expect_constraint_failure "INSERT INTO attempts(id, session_id, question_id, exam_cycle_id, capability_node_id, assessment_role, question_content_version, answer_json, result, submitted_at, idempotency_key) VALUES ('attempt-duplicate', 'session-1', 'question-1', 'cycle-1', 'capability-1', 'practice', 1, '{}', 'incorrect', 1600, 'attempt:duplicate');"
expect_constraint_failure "INSERT INTO decision_observations(id, attempt_id, observation_type, value_code, value_json, source, confidence, occurred_at) VALUES ('observation-invalid', 'attempt-1', 'answer_interaction', 'answer_changed', '{}', 'user', 1, 1600);"
expect_constraint_failure "INSERT INTO tutor_agent_runs(id, run_type, work_pool, status, input_snapshot_json, checkpoint_json, attempt_count, idempotency_key, created_at, updated_at, version) VALUES ('agent-run-invalid-pool', 'content_generation', 'unknown_pool', 'queued', '{}', '{}', 0, 'agent-run-invalid-pool', 1000, 1000, 1);"
expect_constraint_failure "UPDATE learning_evidence SET value = 1 WHERE id = 'evidence-1';"

expect_constraint_failure "DELETE FROM projects WHERE id='project-1';"
expect_count "SELECT COUNT(*) FROM projects WHERE id='project-1';" "1" "project retained while official source evidence exists"
expect_count "SELECT COUNT(*) FROM questions WHERE id='question-1';" "1" "official source-linked question retained"
expect_count "SELECT COUNT(*) FROM question_source_links WHERE id='source-link-1';" "1" "official source link retained"
expect_count "SELECT COUNT(*) FROM content_schema_versions;" "1" "global content schemas after project deletion"
expect_count "SELECT COUNT(*) FROM prompt_definitions WHERE prompt_code='question.generate.weakening';" "1" "prompt definition after version upgrade"
expect_count "SELECT COUNT(*) FROM prompt_versions WHERE prompt_definition_id='prompt-question';" "2" "prompt versions after definition reuse"
expect_count "SELECT COUNT(*) FROM pragma_table_info('tutor_agent_runs') WHERE name='work_pool';" "1" "agent work pool column"

printf 'Tutor database schema verification passed.\n'
