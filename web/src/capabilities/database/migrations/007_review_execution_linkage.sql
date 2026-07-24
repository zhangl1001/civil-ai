ALTER TABLE review_queue
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1);

ALTER TABLE review_queue
  ADD COLUMN claimed_at INTEGER;

ALTER TABLE review_queue
  ADD COLUMN completed_at INTEGER;

ALTER TABLE review_queue
  ADD COLUMN failure_code TEXT;

ALTER TABLE learning_sessions
  ADD COLUMN review_queue_item_id TEXT REFERENCES review_queue(id) ON DELETE SET NULL;

ALTER TABLE daily_plan_items
  ADD COLUMN review_queue_item_id TEXT REFERENCES review_queue(id) ON DELETE SET NULL;

CREATE INDEX learning_sessions_review_queue_idx
  ON learning_sessions(review_queue_item_id, completed_at DESC);

CREATE INDEX daily_plan_items_review_queue_idx
  ON daily_plan_items(review_queue_item_id);
