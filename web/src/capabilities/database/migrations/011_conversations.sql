CREATE TABLE conversation_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT,
  summary_updated_at INTEGER,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
);

CREATE INDEX conversation_sessions_project_idx
  ON conversation_sessions(project_id,updated_at DESC,id DESC);

CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_call_id TEXT,
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
);

CREATE INDEX conversation_messages_session_idx
  ON conversation_messages(session_id,created_at,id);
