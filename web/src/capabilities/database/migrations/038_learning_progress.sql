CREATE TABLE learning_progress (
  id TEXT PRIMARY KEY,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('lecture','digest')),
  resource_key TEXT NOT NULL,
  asset_id TEXT,
  capability_node_id TEXT REFERENCES capability_nodes(id) ON DELETE SET NULL,
  daily_plan_item_id TEXT REFERENCES daily_plan_items(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('started','completed')),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(exam_cycle_id,resource_type,resource_key)
);

CREATE INDEX learning_progress_cycle_status_idx
  ON learning_progress(exam_cycle_id,status,updated_at DESC);

CREATE INDEX learning_progress_capability_idx
  ON learning_progress(exam_cycle_id,capability_node_id,status);
