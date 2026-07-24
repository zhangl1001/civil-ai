CREATE TABLE tutor_agent_runs (
  id TEXT PRIMARY KEY NOT NULL,
  run_type TEXT NOT NULL CHECK(run_type IN ('tutor_turn', 'error_diagnosis', 'teaching_plan', 'content_generation', 'review')),
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'waiting_user', 'completed', 'failed', 'cancelled')),
  exam_cycle_id TEXT REFERENCES exam_cycles(id) ON DELETE CASCADE,
  learning_thread_id TEXT REFERENCES learning_threads(id) ON DELETE SET NULL,
  target_resource_type TEXT,
  target_resource_id TEXT,
  input_snapshot_json TEXT NOT NULL DEFAULT '{}',
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  next_run_at INTEGER,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  error_code TEXT,
  cancellation_reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  completed_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  CHECK(completed_at IS NULL OR completed_at >= created_at),
  CHECK((lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK((status IN ('completed', 'failed', 'cancelled') AND completed_at IS NOT NULL)
    OR status NOT IN ('completed', 'failed', 'cancelled'))
);

CREATE INDEX tutor_agent_runs_schedule_idx
  ON tutor_agent_runs(status, next_run_at, updated_at);
CREATE INDEX tutor_agent_runs_thread_idx
  ON tutor_agent_runs(learning_thread_id, status, updated_at DESC);

CREATE TABLE tutor_agent_run_events (
  id TEXT PRIMARY KEY NOT NULL,
  agent_run_id TEXT NOT NULL REFERENCES tutor_agent_runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('created', 'started', 'waiting_user', 'resumed', 'recovered', 'completed', 'failed', 'cancelled')),
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  occurred_at INTEGER NOT NULL CHECK(occurred_at >= 0),
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE INDEX tutor_agent_run_events_timeline_idx
  ON tutor_agent_run_events(agent_run_id, occurred_at, id);

CREATE TABLE tutor_agent_invocations (
  id TEXT PRIMARY KEY NOT NULL,
  agent_run_id TEXT NOT NULL REFERENCES tutor_agent_runs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_role TEXT NOT NULL,
  prompt_version_id TEXT REFERENCES prompt_versions(id) ON DELETE RESTRICT,
  tool_schema_version TEXT,
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

CREATE INDEX tutor_agent_invocations_run_created_idx
  ON tutor_agent_invocations(agent_run_id, created_at);
