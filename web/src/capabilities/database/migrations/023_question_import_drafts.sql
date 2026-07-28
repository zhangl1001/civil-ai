CREATE TABLE question_import_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  capability_code TEXT NOT NULL,
  module TEXT NOT NULL,
  owner_session_id TEXT,
  source_type TEXT NOT NULL CHECK(source_type IN (
    'official', 'imported', 'user_created', 'ai_generated', 'ai_variant', 'diagnostic_anchor'
  )),
  import_method TEXT NOT NULL CHECK(import_method IN (
    'manual_text', 'structured_file', 'document_scan', 'image_ocr', 'bundled',
    'agent_created', 'system_generated'
  )),
  source_metadata_json TEXT NOT NULL,
  raw_payload_hash TEXT NOT NULL CHECK(length(raw_payload_hash) >= 16),
  status TEXT NOT NULL CHECK(status IN (
    'needs_confirmation', 'confirmed', 'published', 'rejected'
  )),
  issues_json TEXT NOT NULL DEFAULT '[]',
  idempotency_key TEXT NOT NULL UNIQUE,
  published_question_set_id TEXT REFERENCES question_sets(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
);

CREATE INDEX question_import_drafts_status_idx
  ON question_import_drafts(exam_cycle_id, status, updated_at DESC);

CREATE INDEX question_import_drafts_owner_idx
  ON question_import_drafts(owner_session_id, status, updated_at DESC);

CREATE TABLE question_import_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  draft_id TEXT NOT NULL REFERENCES question_import_drafts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK(sequence >= 1),
  raw_json TEXT NOT NULL,
  content_json TEXT,
  content_hash TEXT CHECK(content_hash IS NULL OR length(content_hash) >= 16),
  difficulty REAL NOT NULL CHECK(difficulty BETWEEN 0 AND 1),
  status TEXT NOT NULL CHECK(status IN (
    'ready', 'needs_confirmation', 'rejected', 'published'
  )),
  issues_json TEXT NOT NULL DEFAULT '[]',
  published_question_id TEXT REFERENCES questions(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  UNIQUE(draft_id, sequence)
);

CREATE INDEX question_import_candidates_draft_status_idx
  ON question_import_candidates(draft_id, status, sequence);

CREATE TABLE question_import_publish_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  draft_id TEXT NOT NULL UNIQUE REFERENCES question_import_drafts(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash) >= 16),
  question_set_id TEXT NOT NULL UNIQUE REFERENCES question_sets(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL REFERENCES question_sources(id) ON DELETE RESTRICT,
  published_question_count INTEGER NOT NULL CHECK(published_question_count >= 1),
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
);

CREATE TRIGGER question_import_draft_published_immutable
BEFORE UPDATE ON question_import_drafts
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published question import draft is immutable');
END;

CREATE TRIGGER question_import_candidate_published_immutable
BEFORE UPDATE ON question_import_candidates
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published question import candidate is immutable');
END;
