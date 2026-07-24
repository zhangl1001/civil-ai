CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1)
);

CREATE UNIQUE INDEX projects_one_active_idx ON projects((1)) WHERE status = 'active';

CREATE TABLE candidate_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  preferred_name TEXT,
  time_zone TEXT NOT NULL,
  preparation_experience TEXT,
  current_state_json TEXT NOT NULL DEFAULT '{}',
  extension_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1)
);

CREATE TABLE onboarding_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  draft_json TEXT NOT NULL,
  step_code TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  expires_at INTEGER CHECK(expires_at IS NULL OR expires_at >= updated_at)
);

CREATE TABLE metadata_packages (
  id TEXT PRIMARY KEY NOT NULL,
  package_type TEXT NOT NULL,
  exam_type TEXT NOT NULL,
  region_scope TEXT NOT NULL DEFAULT 'national',
  applicable_year_from INTEGER,
  applicable_year_to INTEGER,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'retired', 'rejected')),
  source TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) >= 16),
  schema_version TEXT NOT NULL,
  release_notes TEXT,
  published_at INTEGER,
  installed_at INTEGER NOT NULL CHECK(installed_at >= 0),
  CHECK(applicable_year_to IS NULL OR applicable_year_from IS NULL OR applicable_year_to >= applicable_year_from),
  CHECK((status = 'published' AND published_at IS NOT NULL) OR status <> 'published'),
  UNIQUE(package_type, exam_type, region_scope, version)
);

CREATE TABLE curriculum_versions (
  id TEXT PRIMARY KEY NOT NULL,
  metadata_package_id TEXT NOT NULL REFERENCES metadata_packages(id) ON DELETE RESTRICT,
  exam_type TEXT NOT NULL,
  region_scope TEXT NOT NULL DEFAULT 'national',
  applicable_year_from INTEGER,
  applicable_year_to INTEGER,
  version TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) >= 16),
  status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'retired')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  CHECK(applicable_year_to IS NULL OR applicable_year_from IS NULL OR applicable_year_to >= applicable_year_from),
  UNIQUE(exam_type, region_scope, version)
);

CREATE TABLE capability_nodes (
  id TEXT PRIMARY KEY NOT NULL,
  curriculum_version_id TEXT NOT NULL REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
  parent_id TEXT REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK(node_type IN (
    'subject', 'module', 'question_type', 'knowledge_point', 'sub_point',
    'cognitive_skill', 'problem_solving_skill', 'exam_strategy', 'expression_skill'
  )),
  subject TEXT NOT NULL,
  module TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0 CHECK(sequence >= 0),
  score_weight REAL NOT NULL DEFAULT 0 CHECK(score_weight >= 0),
  default_target_accuracy REAL CHECK(default_target_accuracy BETWEEN 0 AND 1),
  default_target_seconds REAL CHECK(default_target_seconds > 0),
  mastery_policy_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'retired')),
  UNIQUE(curriculum_version_id, code)
);

CREATE INDEX capability_nodes_parent_sequence_idx
  ON capability_nodes(curriculum_version_id, parent_id, sequence);

CREATE TABLE capability_edges (
  from_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  to_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  relation_type TEXT NOT NULL CHECK(relation_type IN ('prerequisite', 'contains', 'related', 'confusable', 'transfer')),
  weight REAL NOT NULL CHECK(weight BETWEEN 0 AND 1),
  PRIMARY KEY(from_node_id, to_node_id, relation_type),
  CHECK(from_node_id <> to_node_id)
);

CREATE INDEX capability_edges_to_node_idx ON capability_edges(to_node_id, relation_type);

CREATE TABLE assessment_policy_versions (
  id TEXT PRIMARY KEY NOT NULL,
  metadata_package_id TEXT NOT NULL REFERENCES metadata_packages(id) ON DELETE RESTRICT,
  subject TEXT NOT NULL,
  policy_type TEXT NOT NULL,
  version TEXT NOT NULL,
  config_json TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) >= 16),
  status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'retired')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  UNIQUE(subject, policy_type, version)
);

CREATE TABLE exam_cycles (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  exam_type TEXT NOT NULL,
  exam_name TEXT,
  province TEXT,
  position TEXT,
  exam_date TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('foundation', 'development', 'consolidation', 'sprint', 'maintenance')),
  status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
  curriculum_version_id TEXT NOT NULL REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1)
);

CREATE UNIQUE INDEX exam_cycles_one_active_per_project_idx
  ON exam_cycles(project_id) WHERE status = 'active';

CREATE INDEX exam_cycles_project_status_idx ON exam_cycles(project_id, status, updated_at DESC);

CREATE TABLE score_targets (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  target_score REAL NOT NULL CHECK(target_score >= 0),
  max_score REAL NOT NULL CHECK(max_score > 0 AND target_score <= max_score),
  source TEXT NOT NULL CHECK(source IN ('candidate', 'tutor_recommendation')),
  reason TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'superseded', 'cancelled')),
  effective_from INTEGER NOT NULL CHECK(effective_from >= 0),
  supersedes_target_id TEXT REFERENCES score_targets(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
);

CREATE UNIQUE INDEX score_targets_one_active_per_subject_idx
  ON score_targets(exam_cycle_id, subject) WHERE status = 'active';

CREATE INDEX score_targets_history_idx
  ON score_targets(exam_cycle_id, subject, effective_from DESC);

CREATE TABLE score_measurements (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  module TEXT,
  score REAL NOT NULL CHECK(score >= 0),
  max_score REAL NOT NULL CHECK(max_score > 0 AND score <= max_score),
  measurement_type TEXT NOT NULL CHECK(measurement_type IN (
    'self_report', 'official_exam', 'full_mock', 'module_mock', 'initial_diagnosis'
  )),
  source TEXT NOT NULL,
  measured_at INTEGER NOT NULL CHECK(measured_at >= 0),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
);

CREATE INDEX score_measurements_timeline_idx
  ON score_measurements(exam_cycle_id, subject, measured_at DESC);

CREATE TABLE study_constraints (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL UNIQUE REFERENCES exam_cycles(id) ON DELETE CASCADE,
  study_mode TEXT NOT NULL,
  weekly_study_days INTEGER NOT NULL CHECK(weekly_study_days BETWEEN 1 AND 7),
  weekday_minutes INTEGER NOT NULL CHECK(weekday_minutes BETWEEN 0 AND 1440),
  weekend_minutes INTEGER NOT NULL CHECK(weekend_minutes BETWEEN 0 AND 1440),
  max_focus_minutes INTEGER CHECK(max_focus_minutes BETWEEN 5 AND 240),
  available_windows_json TEXT NOT NULL DEFAULT '[]',
  interruption_risks_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1)
);

CREATE TABLE learning_preferences (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL UNIQUE REFERENCES exam_cycles(id) ON DELETE CASCADE,
  teaching_order TEXT NOT NULL,
  explanation_depth TEXT NOT NULL CHECK(explanation_depth IN ('concise', 'balanced', 'deep')),
  proactive_level TEXT NOT NULL CHECK(proactive_level IN ('quiet', 'balanced', 'active')),
  companion_tone TEXT NOT NULL,
  quiet_hours_json TEXT NOT NULL DEFAULT '[]',
  accessibility_json TEXT NOT NULL DEFAULT '{}',
  extension_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1)
);

CREATE TABLE exam_cycle_policy_bindings (
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  policy_type TEXT NOT NULL,
  assessment_policy_version_id TEXT NOT NULL REFERENCES assessment_policy_versions(id) ON DELETE RESTRICT,
  bound_at INTEGER NOT NULL CHECK(bound_at >= 0),
  PRIMARY KEY(exam_cycle_id, subject, policy_type)
);

CREATE TABLE domain_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at INTEGER NOT NULL CHECK(occurred_at >= 0),
  published_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  next_attempt_at INTEGER,
  claimed_by TEXT,
  claim_expires_at INTEGER,
  last_error_code TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  CHECK((claimed_by IS NULL AND claim_expires_at IS NULL) OR (claimed_by IS NOT NULL AND claim_expires_at IS NOT NULL))
);

CREATE INDEX domain_outbox_pending_idx
  ON domain_outbox(published_at, next_attempt_at, claim_expires_at, occurred_at);

CREATE TABLE command_receipts (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  command_type TEXT NOT NULL,
  result_resource_type TEXT NOT NULL,
  result_resource_id TEXT NOT NULL,
  completed_at INTEGER NOT NULL CHECK(completed_at >= 0)
);

CREATE INDEX command_receipts_result_idx
  ON command_receipts(result_resource_type, result_resource_id);

CREATE TRIGGER curriculum_requires_published_package_insert
BEFORE INSERT ON curriculum_versions
WHEN (SELECT status FROM metadata_packages WHERE id = NEW.metadata_package_id) <> 'published'
BEGIN
  SELECT RAISE(ABORT, 'curriculum metadata package must be published');
END;

CREATE TRIGGER capability_parent_same_curriculum_insert
BEFORE INSERT ON capability_nodes
WHEN NEW.parent_id IS NOT NULL
  AND (SELECT curriculum_version_id FROM capability_nodes WHERE id = NEW.parent_id) <> NEW.curriculum_version_id
BEGIN
  SELECT RAISE(ABORT, 'capability parent must use the same curriculum version');
END;
