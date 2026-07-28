CREATE TABLE tutor_cycle_conclusions (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE RESTRICT,
  learning_thread_id TEXT NOT NULL REFERENCES learning_threads(id) ON DELETE RESTRICT,
  learning_session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE RESTRICT,
  question_set_id TEXT NOT NULL REFERENCES question_sets(id) ON DELETE RESTRICT,
  capability_node_ids_json TEXT NOT NULL,
  conclusion_type TEXT NOT NULL CHECK(conclusion_type IN ('objective_session')),
  decision_scope TEXT NOT NULL CHECK(decision_scope IN ('single_capability','single_module','cross_module')),
  observation_json TEXT NOT NULL,
  diagnosis_json TEXT NOT NULL,
  proposal_json TEXT NOT NULL,
  execution_json TEXT NOT NULL,
  assessment_json TEXT NOT NULL,
  schedule_json TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
);

CREATE INDEX tutor_cycle_conclusions_cycle_idx
  ON tutor_cycle_conclusions(exam_cycle_id, created_at DESC);

CREATE INDEX tutor_cycle_conclusions_thread_idx
  ON tutor_cycle_conclusions(learning_thread_id, created_at DESC);
