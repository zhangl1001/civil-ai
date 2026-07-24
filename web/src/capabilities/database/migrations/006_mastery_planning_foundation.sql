CREATE TABLE mastery_tracks (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK(state IN ('unassessed','diagnosed','learning','practicing','consolidating','mastered','maintaining','regressed')),
  concept REAL NOT NULL CHECK(concept BETWEEN 0 AND 1), recognition REAL NOT NULL CHECK(recognition BETWEEN 0 AND 1),
  method REAL NOT NULL CHECK(method BETWEEN 0 AND 1), accuracy REAL NOT NULL CHECK(accuracy BETWEEN 0 AND 1),
  speed REAL NOT NULL CHECK(speed BETWEEN 0 AND 1), retention REAL NOT NULL CHECK(retention BETWEEN 0 AND 1),
  transfer REAL NOT NULL CHECK(transfer BETWEEN 0 AND 1), stability REAL NOT NULL CHECK(stability BETWEEN 0 AND 1),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1), effective_sample REAL NOT NULL CHECK(effective_sample >= 0),
  last_evidence_at INTEGER, last_state_change_at INTEGER NOT NULL, algorithm_version TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(exam_cycle_id, capability_node_id)
);
CREATE INDEX mastery_tracks_cycle_state_idx ON mastery_tracks(exam_cycle_id, state, confidence, updated_at DESC);

CREATE TABLE mastery_snapshots (
  id TEXT PRIMARY KEY NOT NULL, mastery_track_id TEXT NOT NULL REFERENCES mastery_tracks(id) ON DELETE CASCADE,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE, snapshot_json TEXT NOT NULL,
  algorithm_version TEXT NOT NULL, evidence_cutoff_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX mastery_snapshots_track_idx ON mastery_snapshots(mastery_track_id, created_at DESC);

CREATE TABLE review_queue (
  id TEXT PRIMARY KEY NOT NULL, exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  mastery_track_id TEXT NOT NULL REFERENCES mastery_tracks(id) ON DELETE CASCADE,
  review_type TEXT NOT NULL CHECK(review_type IN ('retention','transfer','anchor','repair')),
  due_at INTEGER NOT NULL, priority REAL NOT NULL CHECK(priority >= 0), interval_days REAL NOT NULL CHECK(interval_days >= 0),
  stability_before REAL NOT NULL CHECK(stability_before BETWEEN 0 AND 1), status TEXT NOT NULL CHECK(status IN ('scheduled','in_progress','completed','cancelled','failed')),
  reason TEXT NOT NULL, source_evidence_id TEXT REFERENCES learning_evidence(id) ON DELETE SET NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX review_queue_one_active_idx ON review_queue(exam_cycle_id, capability_node_id, review_type) WHERE status IN ('scheduled','in_progress');
CREATE INDEX review_queue_due_idx ON review_queue(exam_cycle_id, status, due_at, priority DESC);

CREATE TABLE daily_plans (
  id TEXT PRIMARY KEY NOT NULL, exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  plan_date TEXT NOT NULL, version INTEGER NOT NULL CHECK(version >= 1), status TEXT NOT NULL CHECK(status IN ('draft','active','superseded','completed','cancelled')),
  phase TEXT NOT NULL, available_minutes INTEGER NOT NULL CHECK(available_minutes >= 0), decision_summary TEXT NOT NULL,
  decision_factors_json TEXT NOT NULL, created_by TEXT NOT NULL CHECK(created_by IN ('system','tutor_ai','user')),
  created_at INTEGER NOT NULL, supersedes_plan_id TEXT REFERENCES daily_plans(id) ON DELETE RESTRICT,
  UNIQUE(exam_cycle_id, plan_date, version)
);
CREATE INDEX daily_plans_current_idx ON daily_plans(exam_cycle_id, plan_date, status, version DESC);

CREATE TABLE daily_plan_items (
  id TEXT PRIMARY KEY NOT NULL, daily_plan_id TEXT NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  learning_thread_id TEXT REFERENCES learning_threads(id) ON DELETE SET NULL,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  item_type TEXT NOT NULL CHECK(item_type IN ('diagnosis','lecture','guided_practice','independent_practice','variant','timed','review','transfer','mock','essay','digest')),
  sequence INTEGER NOT NULL CHECK(sequence >= 1), target_minutes INTEGER NOT NULL CHECK(target_minutes >= 0), target_count INTEGER CHECK(target_count IS NULL OR target_count >= 0),
  exit_criteria_json TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','in_progress','completed','skipped','cancelled')),
  actual_minutes INTEGER NOT NULL DEFAULT 0 CHECK(actual_minutes >= 0), result_summary_json TEXT,
  UNIQUE(daily_plan_id, sequence)
);
