CREATE TABLE learning_assets (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN (
    'essay_question','essay_draft','essay_attempt','interview_session','digest_daily',
    'digest_monthly','study_lecture','mock_manifest'
  )),
  business_key TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','ready','retired')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  source_agent_run_id TEXT REFERENCES tutor_agent_runs(id) ON DELETE SET NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
);

CREATE UNIQUE INDEX learning_assets_version_idx
  ON learning_assets(exam_cycle_id,kind,business_key,version);

CREATE INDEX learning_assets_latest_idx
  ON learning_assets(exam_cycle_id,kind,business_key,status,updated_at DESC);

CREATE INDEX learning_assets_timeline_idx
  ON learning_assets(exam_cycle_id,kind,created_at DESC);
