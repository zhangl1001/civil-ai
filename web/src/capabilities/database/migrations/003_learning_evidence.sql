CREATE TABLE learning_threads (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  primary_capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  origin_type TEXT NOT NULL CHECK(origin_type IN ('diagnosis', 'wrong_answer', 'daily_plan', 'user_request', 'tutor_decision')),
  origin_ref_id TEXT,
  goal TEXT NOT NULL CHECK(length(trim(goal)) BETWEEN 1 AND 500),
  gap_snapshot_json TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN (
    'diagnose', 'prerequisite', 'teach', 'guided', 'independent',
    'consolidate', 'retention', 'transfer', 'maintain'
  )),
  status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'completed', 'abandoned')),
  exit_criteria_json TEXT NOT NULL,
  next_action_json TEXT,
  started_at INTEGER NOT NULL CHECK(started_at >= 0),
  paused_at INTEGER,
  completed_at INTEGER,
  closed_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  CHECK(paused_at IS NULL OR paused_at >= started_at),
  CHECK(completed_at IS NULL OR completed_at >= started_at),
  CHECK((status = 'paused' AND paused_at IS NOT NULL) OR status <> 'paused'),
  CHECK((status IN ('completed', 'abandoned') AND completed_at IS NOT NULL) OR status NOT IN ('completed', 'abandoned'))
);

CREATE UNIQUE INDEX learning_threads_one_open_capability_idx
  ON learning_threads(exam_cycle_id, primary_capability_node_id)
  WHERE status IN ('active', 'paused');

CREATE INDEX learning_threads_cycle_status_idx
  ON learning_threads(exam_cycle_id, status, updated_at DESC);

CREATE TABLE learning_thread_events (
  id TEXT PRIMARY KEY NOT NULL,
  learning_thread_id TEXT NOT NULL REFERENCES learning_threads(id) ON DELETE CASCADE,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'created', 'stage_advanced', 'paused', 'resumed', 'completed',
    'abandoned', 'strategy_changed', 'user_intervened'
  )),
  from_stage TEXT,
  to_stage TEXT,
  reason_code TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  occurred_at INTEGER NOT NULL CHECK(occurred_at >= 0),
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE INDEX learning_thread_events_timeline_idx
  ON learning_thread_events(learning_thread_id, occurred_at, id);

CREATE TABLE teaching_blueprints (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  learning_thread_id TEXT NOT NULL REFERENCES learning_threads(id) ON DELETE CASCADE,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  objective TEXT NOT NULL CHECK(length(trim(objective)) BETWEEN 1 AND 500),
  prerequisite_snapshot_json TEXT NOT NULL,
  teaching_strategy TEXT NOT NULL,
  difficulty_path_json TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'completed', 'retired')),
  created_by TEXT NOT NULL CHECK(created_by IN ('system', 'tutor_ai', 'user')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  UNIQUE(learning_thread_id, version)
);

ALTER TABLE generation_specs
  ADD COLUMN learning_thread_id TEXT REFERENCES learning_threads(id) ON DELETE SET NULL;

ALTER TABLE lectures
  ADD COLUMN learning_thread_id TEXT REFERENCES learning_threads(id) ON DELETE SET NULL;

ALTER TABLE lectures
  ADD COLUMN teaching_blueprint_id TEXT REFERENCES teaching_blueprints(id) ON DELETE SET NULL;

ALTER TABLE question_sets
  ADD COLUMN learning_thread_id TEXT REFERENCES learning_threads(id) ON DELETE SET NULL;

ALTER TABLE question_sets
  ADD COLUMN teaching_blueprint_id TEXT REFERENCES teaching_blueprints(id) ON DELETE SET NULL;

CREATE INDEX question_sets_thread_created_idx
  ON question_sets(learning_thread_id, created_at DESC);

CREATE TABLE learning_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  learning_thread_id TEXT REFERENCES learning_threads(id) ON DELETE SET NULL,
  question_set_id TEXT NOT NULL REFERENCES question_sets(id) ON DELETE RESTRICT,
  session_type TEXT NOT NULL CHECK(session_type IN ('practice', 'review', 'diagnosis', 'mock', 'retention', 'transfer', 'anchor')),
  assessment_role TEXT NOT NULL CHECK(assessment_role IN ('teaching', 'guided', 'practice', 'retention', 'transfer', 'anchor')),
  status TEXT NOT NULL CHECK(status IN ('in_progress', 'completed', 'abandoned')),
  started_at INTEGER NOT NULL CHECK(started_at >= 0),
  completed_at INTEGER,
  elapsed_ms INTEGER CHECK(elapsed_ms IS NULL OR elapsed_ms >= 0),
  question_count INTEGER NOT NULL CHECK(question_count >= 1),
  answered_count INTEGER NOT NULL DEFAULT 0 CHECK(answered_count >= 0 AND answered_count <= question_count),
  correct_count INTEGER NOT NULL DEFAULT 0 CHECK(correct_count >= 0 AND correct_count <= answered_count),
  idempotency_key TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  CHECK((status = 'completed' AND completed_at IS NOT NULL) OR status <> 'completed'),
  CHECK(completed_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX learning_sessions_cycle_timeline_idx
  ON learning_sessions(exam_cycle_id, started_at DESC);

CREATE INDEX learning_sessions_thread_status_idx
  ON learning_sessions(learning_thread_id, status, updated_at DESC);

CREATE TABLE question_exposures (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  learning_thread_id TEXT REFERENCES learning_threads(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES learning_sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  exposure_type TEXT NOT NULL CHECK(exposure_type IN ('lecture_example', 'preview', 'hint', 'practice', 'assessment')),
  answer_exposed INTEGER NOT NULL DEFAULT 0 CHECK(answer_exposed IN (0, 1)),
  occurred_at INTEGER NOT NULL CHECK(occurred_at >= 0),
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE INDEX question_exposures_integrity_idx
  ON question_exposures(exam_cycle_id, question_id, exposure_type, occurred_at DESC);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  learning_thread_id TEXT REFERENCES learning_threads(id) ON DELETE SET NULL,
  assessment_role TEXT NOT NULL CHECK(assessment_role IN ('teaching', 'guided', 'practice', 'retention', 'transfer', 'anchor')),
  question_content_version INTEGER NOT NULL CHECK(question_content_version >= 1),
  answer_json TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('correct', 'incorrect', 'unanswered', 'partial')),
  score REAL CHECK(score IS NULL OR score BETWEEN 0 AND 1),
  elapsed_ms INTEGER CHECK(elapsed_ms IS NULL OR elapsed_ms >= 0),
  confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  hint_level INTEGER NOT NULL DEFAULT 0 CHECK(hint_level BETWEEN 0 AND 5),
  answer_change_count INTEGER NOT NULL DEFAULT 0 CHECK(answer_change_count >= 0),
  submitted_at INTEGER NOT NULL CHECK(submitted_at >= 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  UNIQUE(session_id, question_id)
);

CREATE INDEX attempts_cycle_capability_idx
  ON attempts(exam_cycle_id, capability_node_id, submitted_at DESC);

CREATE TABLE decision_observations (
  id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  observation_type TEXT NOT NULL CHECK(observation_type IN (
    'question_recognition', 'method_selection', 'key_evidence', 'option_elimination',
    'error_stage', 'confidence_report', 'user_confirmation'
  )),
  value_code TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL CHECK(source IN ('user', 'system', 'tutor_ai')),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  occurred_at INTEGER NOT NULL CHECK(occurred_at >= 0)
);

CREATE INDEX decision_observations_attempt_idx
  ON decision_observations(attempt_id, observation_type, occurred_at);

CREATE TABLE grading_results (
  id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  grading_method TEXT NOT NULL CHECK(grading_method IN ('deterministic', 'ai_assisted', 'rubric')),
  grader_version TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('correct', 'incorrect', 'unanswered', 'partial')),
  score REAL CHECK(score IS NULL OR score BETWEEN 0 AND 1),
  normalized_feedback_json TEXT NOT NULL DEFAULT '{}',
  raw_response_json TEXT,
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  confirmation_status TEXT NOT NULL CHECK(confirmation_status IN ('not_required', 'pending', 'confirmed', 'rejected', 'corrected')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  UNIQUE(attempt_id, grading_method, grader_version)
);

CREATE TABLE error_diagnoses (
  id TEXT PRIMARY KEY NOT NULL,
  grading_result_id TEXT NOT NULL REFERENCES grading_results(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  cause_code TEXT NOT NULL CHECK(cause_code IN (
    'concept_gap', 'recognition_error', 'method_selection_error', 'reasoning_error',
    'calculation_error', 'evidence_extraction_error', 'trap_misjudgment',
    'time_management_error', 'careless_error', 'transfer_failure',
    'retention_failure', 'unknown'
  )),
  error_stage TEXT,
  detail TEXT NOT NULL CHECK(length(trim(detail)) >= 1),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  confirmation_status TEXT NOT NULL CHECK(confirmation_status IN ('pending', 'confirmed', 'rejected', 'corrected')),
  prerequisite_capability_node_id TEXT REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  recommended_action_code TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('deterministic', 'tutor_ai', 'user')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE INDEX error_diagnoses_cycle_cause_idx
  ON error_diagnoses(exam_cycle_id, cause_code, created_at DESC);

CREATE TABLE learning_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE CASCADE,
  intervention_id TEXT,
  assessment_role TEXT NOT NULL CHECK(assessment_role IN ('teaching', 'guided', 'practice', 'retention', 'transfer', 'anchor')),
  evidence_type TEXT NOT NULL CHECK(evidence_type IN (
    'correctness', 'speed', 'retention', 'transfer', 'method_recognition',
    'error_recurrence', 'teaching_comprehension', 'user_confirmation'
  )),
  value REAL,
  weight REAL NOT NULL CHECK(weight BETWEEN 0 AND 1),
  quality REAL NOT NULL CHECK(quality BETWEEN 0 AND 1),
  source TEXT NOT NULL CHECK(source IN ('deterministic_grader', 'ai_grader', 'user_confirmation', 'system')),
  validation_policy_version TEXT NOT NULL,
  occurred_at INTEGER NOT NULL CHECK(occurred_at >= 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX learning_evidence_valid_query_idx
  ON learning_evidence(exam_cycle_id, capability_node_id, occurred_at DESC);

CREATE TABLE evidence_corrections (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES learning_evidence(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('invalidate', 'supersede', 'dispute', 'reinstate')),
  reason_code TEXT NOT NULL,
  reason_detail TEXT,
  replacement_evidence_id TEXT REFERENCES learning_evidence(id) ON DELETE RESTRICT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user', 'system', 'tutor_ai')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  CHECK((action = 'supersede' AND replacement_evidence_id IS NOT NULL) OR action <> 'supersede'),
  CHECK(replacement_evidence_id IS NULL OR replacement_evidence_id <> evidence_id)
);

CREATE INDEX evidence_corrections_evidence_idx
  ON evidence_corrections(evidence_id, created_at DESC);

CREATE TABLE evidence_validity_projection (
  evidence_id TEXT PRIMARY KEY NOT NULL REFERENCES learning_evidence(id) ON DELETE CASCADE,
  validity_status TEXT NOT NULL CHECK(validity_status IN ('valid', 'invalid', 'superseded', 'disputed')),
  latest_correction_id TEXT REFERENCES evidence_corrections(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
  version INTEGER NOT NULL CHECK(version >= 1)
);

CREATE TRIGGER learning_evidence_immutable_update
BEFORE UPDATE ON learning_evidence
BEGIN
  SELECT RAISE(ABORT, 'learning evidence is immutable');
END;

CREATE TRIGGER attempt_cycle_matches_session_insert
BEFORE INSERT ON attempts
WHEN (SELECT exam_cycle_id FROM learning_sessions WHERE id = NEW.session_id) <> NEW.exam_cycle_id
BEGIN
  SELECT RAISE(ABORT, 'attempt exam cycle must match learning session');
END;

CREATE TRIGGER attempt_question_belongs_to_session_set_insert
BEFORE INSERT ON attempts
WHEN NOT EXISTS (
  SELECT 1 FROM learning_sessions session
  JOIN questions question ON question.question_set_id = session.question_set_id
  WHERE session.id = NEW.session_id AND question.id = NEW.question_id
)
BEGIN
  SELECT RAISE(ABORT, 'attempt question must belong to learning session question set');
END;

CREATE TRIGGER evidence_attempt_consistency_insert
BEFORE INSERT ON learning_evidence
WHEN NEW.attempt_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM attempts attempt
  WHERE attempt.id = NEW.attempt_id
    AND attempt.exam_cycle_id = NEW.exam_cycle_id
    AND attempt.capability_node_id = NEW.capability_node_id
)
BEGIN
  SELECT RAISE(ABORT, 'learning evidence must match attempt cycle and capability');
END;
