DROP TABLE IF EXISTS conversation_sessions;

CREATE TABLE conversation_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
);

CREATE INDEX conversation_sessions_project_idx
  ON conversation_sessions(project_id,updated_at DESC,id DESC);
