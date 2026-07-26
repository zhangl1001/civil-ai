ALTER TABLE tutor_agent_run_events RENAME TO tutor_agent_run_events_legacy;

CREATE TABLE tutor_agent_run_events (
  id TEXT PRIMARY KEY NOT NULL,
  agent_run_id TEXT NOT NULL REFERENCES tutor_agent_runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('created', 'started', 'progressed', 'waiting_user', 'resumed', 'recovered', 'completed', 'failed', 'cancelled')),
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  occurred_at INTEGER NOT NULL CHECK(occurred_at >= 0),
  idempotency_key TEXT NOT NULL UNIQUE
);

INSERT INTO tutor_agent_run_events(
  id,agent_run_id,event_type,from_status,to_status,reason_code,payload_json,occurred_at,idempotency_key
)
SELECT
  id,agent_run_id,event_type,from_status,to_status,reason_code,payload_json,occurred_at,idempotency_key
FROM tutor_agent_run_events_legacy;

DROP TABLE tutor_agent_run_events_legacy;

CREATE INDEX tutor_agent_run_events_timeline_idx
  ON tutor_agent_run_events(agent_run_id, occurred_at, id);

CREATE TABLE system_messages (
  id TEXT PRIMARY KEY NOT NULL,
  business_line TEXT NOT NULL CHECK(business_line IN ('tutor','practice','essay','interview','planning','review','exam','digest','profile','system')),
  category TEXT NOT NULL CHECK(category IN ('task','learning','reminder','result','warning','system')),
  event_code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('info','success','warning','error')),
  status TEXT NOT NULL CHECK(status IN ('unread','read','archived')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  action_route TEXT,
  action_params_json TEXT NOT NULL DEFAULT '{}',
  dedup_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  read_at INTEGER,
  archived_at INTEGER
);

CREATE INDEX system_messages_timeline_idx
  ON system_messages(status, created_at DESC, id DESC);

CREATE INDEX system_messages_business_idx
  ON system_messages(business_line, category, created_at DESC);
