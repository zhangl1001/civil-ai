CREATE TABLE content_metadata_releases (
  id TEXT PRIMARY KEY NOT NULL,
  version TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) >= 16),
  status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'retired')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  UNIQUE(version, content_hash)
);

CREATE TABLE content_schema_versions (
  id TEXT PRIMARY KEY NOT NULL,
  release_id TEXT NOT NULL REFERENCES content_metadata_releases(id) ON DELETE RESTRICT,
  schema_code TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK(document_type IN ('lecture', 'question', 'explanation', 'wrong_cause', 'feedback')),
  version TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) >= 16),
  status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'retired')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  UNIQUE(schema_code, version)
);

CREATE TABLE question_template_versions (
  id TEXT PRIMARY KEY NOT NULL,
  release_id TEXT NOT NULL REFERENCES content_metadata_releases(id) ON DELETE RESTRICT,
  template_code TEXT NOT NULL,
  version TEXT NOT NULL,
  renderer_code TEXT NOT NULL,
  content_schema_version_id TEXT NOT NULL REFERENCES content_schema_versions(id) ON DELETE RESTRICT,
  config_json TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) >= 16),
  status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'retired')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  UNIQUE(template_code, version)
);

CREATE TABLE prompt_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  prompt_code TEXT NOT NULL UNIQUE,
  task_type TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'retired')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
);

CREATE TABLE prompt_versions (
  id TEXT PRIMARY KEY NOT NULL,
  prompt_definition_id TEXT NOT NULL REFERENCES prompt_definitions(id) ON DELETE RESTRICT,
  version TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  sections_json TEXT NOT NULL,
  compatible_schema_versions_json TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) >= 16),
  status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'retired')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  UNIQUE(prompt_definition_id, version)
);

CREATE TABLE generation_specs (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  content_kind TEXT NOT NULL CHECK(content_kind IN ('lecture', 'question_set', 'lecture_with_questions')),
  assessment_role TEXT NOT NULL CHECK(assessment_role IN ('teaching', 'guided', 'practice', 'retention', 'transfer', 'anchor')),
  question_template_version_id TEXT REFERENCES question_template_versions(id) ON DELETE RESTRICT,
  content_schema_version_id TEXT NOT NULL REFERENCES content_schema_versions(id) ON DELETE RESTRICT,
  prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT,
  requested_count INTEGER CHECK(requested_count IS NULL OR requested_count BETWEEN 1 AND 100),
  difficulty_json TEXT NOT NULL,
  constraints_json TEXT NOT NULL,
  context_snapshot_json TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) >= 16),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  CHECK(content_kind = 'lecture' OR question_template_version_id IS NOT NULL)
);

CREATE INDEX generation_specs_cycle_capability_idx
  ON generation_specs(exam_cycle_id, capability_node_id, created_at DESC);

CREATE TABLE generation_workflows (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  generation_spec_id TEXT NOT NULL REFERENCES generation_specs(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  workflow_type TEXT NOT NULL CHECK(workflow_type IN ('lecture', 'question_set', 'lecture_with_questions')),
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'validating', 'staged', 'committed', 'failed', 'cancelled')),
  current_step TEXT NOT NULL CHECK(current_step IN (
    'prepare_context', 'compile_prompt', 'invoke_model', 'parse_structure',
    'validate_schema', 'validate_domain', 'quality_review', 'stage_result',
    'commit_result', 'publish_outbox', 'complete'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  staged_result_json TEXT,
  validation_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  started_at INTEGER NOT NULL CHECK(started_at >= 0),
  completed_at INTEGER CHECK(completed_at IS NULL OR completed_at >= started_at),
  updated_at INTEGER NOT NULL CHECK(updated_at >= started_at),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1)
);

CREATE INDEX generation_workflows_resume_idx
  ON generation_workflows(status, updated_at);

CREATE TABLE content_documents (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK(document_type IN ('lecture', 'question', 'explanation', 'wrong_cause', 'feedback')),
  schema_version_id TEXT NOT NULL REFERENCES content_schema_versions(id) ON DELETE RESTRICT,
  title TEXT,
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) >= 16),
  status TEXT NOT NULL CHECK(status IN ('staged', 'validated', 'published', 'rejected', 'retired')),
  content_version INTEGER NOT NULL DEFAULT 1 CHECK(content_version >= 1),
  supersedes_document_id TEXT REFERENCES content_documents(id) ON DELETE RESTRICT,
  generator_workflow_id TEXT REFERENCES generation_workflows(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
);

CREATE INDEX content_documents_cycle_type_idx
  ON content_documents(exam_cycle_id, document_type, created_at DESC);

CREATE TABLE lectures (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  content_document_id TEXT NOT NULL UNIQUE REFERENCES content_documents(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('staged', 'ready', 'retired', 'rejected')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
);

CREATE INDEX lectures_cycle_capability_idx
  ON lectures(exam_cycle_id, capability_node_id, created_at DESC);

CREATE TABLE question_sets (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  generation_spec_id TEXT NOT NULL REFERENCES generation_specs(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  purpose TEXT NOT NULL CHECK(purpose IN ('diagnosis', 'teaching', 'guided', 'practice', 'retention', 'transfer', 'anchor', 'mock')),
  assessment_role TEXT NOT NULL CHECK(assessment_role IN ('teaching', 'guided', 'practice', 'retention', 'transfer', 'anchor')),
  module TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('staging', 'ready', 'retired', 'rejected')),
  question_count INTEGER NOT NULL CHECK(question_count >= 0),
  content_hash TEXT,
  content_version INTEGER NOT NULL DEFAULT 1 CHECK(content_version >= 1),
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
);

CREATE INDEX question_sets_cycle_purpose_idx
  ON question_sets(exam_cycle_id, purpose, created_at DESC);

CREATE TABLE lecture_question_sets (
  lecture_id TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  question_set_id TEXT NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
  relation_role TEXT NOT NULL CHECK(relation_role IN ('primary', 'extension', 'review')),
  PRIMARY KEY(lecture_id, question_set_id)
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY NOT NULL,
  question_set_id TEXT NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  question_template_version_id TEXT NOT NULL REFERENCES question_template_versions(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK(sequence >= 1),
  difficulty REAL NOT NULL CHECK(difficulty BETWEEN 0 AND 1),
  cognitive_level TEXT NOT NULL,
  purpose TEXT NOT NULL,
  assessment_role TEXT NOT NULL CHECK(assessment_role IN ('teaching', 'guided', 'practice', 'retention', 'transfer', 'anchor')),
  variant_group_id TEXT,
  content_json TEXT NOT NULL,
  correct_answer_json TEXT NOT NULL,
  quality_status TEXT NOT NULL CHECK(quality_status IN ('staged', 'validated', 'published', 'rejected', 'retired')),
  content_hash TEXT NOT NULL CHECK(length(content_hash) >= 16),
  content_schema_version_id TEXT NOT NULL REFERENCES content_schema_versions(id) ON DELETE RESTRICT,
  content_version INTEGER NOT NULL DEFAULT 1 CHECK(content_version >= 1),
  generator_workflow_id TEXT NOT NULL REFERENCES generation_workflows(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  UNIQUE(question_set_id, sequence)
);

CREATE INDEX questions_cycle_capability_idx
  ON questions(exam_cycle_id, capability_node_id, created_at DESC);

CREATE TABLE question_capabilities (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  relation_role TEXT NOT NULL CHECK(relation_role IN ('primary', 'prerequisite', 'secondary', 'transfer')),
  weight REAL NOT NULL CHECK(weight > 0 AND weight <= 1),
  PRIMARY KEY(question_id, capability_node_id, relation_role)
);

CREATE INDEX question_capabilities_node_idx
  ON question_capabilities(capability_node_id, relation_role);

CREATE TABLE ai_invocations (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES generation_workflows(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_role TEXT NOT NULL,
  prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT,
  content_schema_version_id TEXT REFERENCES content_schema_versions(id) ON DELETE RESTRICT,
  request_hash TEXT NOT NULL CHECK(length(request_hash) >= 16),
  provider_request_id TEXT,
  input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens >= 0),
  latency_ms INTEGER CHECK(latency_ms IS NULL OR latency_ms >= 0),
  finish_reason TEXT,
  validation_status TEXT NOT NULL CHECK(validation_status IN ('pending', 'valid', 'invalid', 'cancelled')),
  error_code TEXT,
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
);

CREATE INDEX ai_invocations_workflow_created_idx
  ON ai_invocations(workflow_id, created_at);

CREATE TRIGGER question_cycle_matches_set_insert
BEFORE INSERT ON questions
WHEN (SELECT exam_cycle_id FROM question_sets WHERE id = NEW.question_set_id) <> NEW.exam_cycle_id
BEGIN
  SELECT RAISE(ABORT, 'question exam cycle must match question set');
END;

CREATE TRIGGER question_primary_capability_insert
AFTER INSERT ON questions
BEGIN
  INSERT INTO question_capabilities(question_id, capability_node_id, relation_role, weight)
  VALUES (NEW.id, NEW.capability_node_id, 'primary', 1);
END;
