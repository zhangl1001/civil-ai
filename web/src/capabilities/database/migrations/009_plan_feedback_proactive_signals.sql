ALTER TABLE daily_plan_items ADD COLUMN failure_code TEXT;
ALTER TABLE daily_plan_items ADD COLUMN failure_message TEXT;
ALTER TABLE daily_plan_items ADD COLUMN finished_at INTEGER CHECK(finished_at IS NULL OR finished_at >= 0);

CREATE TABLE proactive_signals (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL CHECK(signal_type IN (
    'daily_checkin','review_due','plan_at_risk','mastery_regressed','goal_gap','celebration'
  )),
  status TEXT NOT NULL CHECK(status IN ('pending','delivered','acted','dismissed','expired')),
  priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 100),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  action_route TEXT,
  action_params_json TEXT NOT NULL DEFAULT '{}',
  dedup_key TEXT NOT NULL UNIQUE,
  available_at INTEGER NOT NULL CHECK(available_at >= 0),
  expires_at INTEGER,
  delivered_at INTEGER,
  acted_at INTEGER,
  dismissed_at INTEGER,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  CHECK(expires_at IS NULL OR expires_at >= available_at)
);

CREATE INDEX proactive_signals_delivery_idx
  ON proactive_signals(exam_cycle_id, status, available_at, priority DESC);

CREATE INDEX proactive_signals_type_cooldown_idx
  ON proactive_signals(exam_cycle_id, signal_type, created_at DESC);
