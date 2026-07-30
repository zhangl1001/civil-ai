CREATE TABLE agent_tool_receipts (
  agent_run_id TEXT NOT NULL REFERENCES tutor_agent_runs(id) ON DELETE CASCADE,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  business_idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('prepared', 'running', 'succeeded', 'failed', 'unknown')),
  result_json TEXT,
  result_ref TEXT,
  failure_code TEXT,
  retryable INTEGER NOT NULL DEFAULT 1 CHECK(retryable IN (0, 1)),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  lease_epoch INTEGER NOT NULL DEFAULT 0 CHECK(lease_epoch >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
  PRIMARY KEY(agent_run_id, tool_call_id)
);

CREATE INDEX agent_tool_receipts_status_idx
  ON agent_tool_receipts(status, updated_at);

CREATE INDEX agent_tool_receipts_business_key_idx
  ON agent_tool_receipts(business_idempotency_key);
