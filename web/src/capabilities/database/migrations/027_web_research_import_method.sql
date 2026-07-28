PRAGMA defer_foreign_keys = ON;

DROP TRIGGER IF EXISTS question_sources_official_immutable_update;
DROP TRIGGER IF EXISTS question_sources_official_immutable_delete;
DROP TRIGGER IF EXISTS official_question_link_immutable_update;
DROP TRIGGER IF EXISTS official_question_link_immutable_delete;
DROP TRIGGER IF EXISTS question_import_draft_published_immutable;
DROP TRIGGER IF EXISTS question_import_candidate_published_immutable;

ALTER TABLE question_source_links RENAME TO question_source_links_v26;
ALTER TABLE question_source_import_receipts RENAME TO question_source_import_receipts_v26;
ALTER TABLE question_import_publish_receipts RENAME TO question_import_publish_receipts_v26;
ALTER TABLE question_import_candidates RENAME TO question_import_candidates_v26;
ALTER TABLE question_sources RENAME TO question_sources_v26;
ALTER TABLE question_import_drafts RENAME TO question_import_drafts_v26;

CREATE TABLE question_sources (
  id TEXT PRIMARY KEY NOT NULL,
  identity_hash TEXT NOT NULL UNIQUE CHECK(length(identity_hash) >= 16),
  source_type TEXT NOT NULL CHECK(source_type IN (
    'official', 'imported', 'user_created', 'ai_generated', 'ai_variant', 'diagnostic_anchor'
  )),
  provider TEXT,
  exam_type TEXT,
  exam_year INTEGER CHECK(exam_year IS NULL OR exam_year BETWEEN 1990 AND 2200),
  province TEXT,
  exam_batch TEXT,
  paper_name TEXT,
  section_name TEXT,
  provenance_json TEXT NOT NULL,
  import_method TEXT NOT NULL CHECK(import_method IN (
    'manual_text', 'structured_file', 'document_scan', 'image_ocr', 'web_research',
    'bundled', 'agent_created', 'system_generated'
  )),
  content_hash TEXT NOT NULL UNIQUE CHECK(length(content_hash) >= 16),
  source_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'archived', 'rejected')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
);

CREATE TABLE question_source_links (
  id TEXT PRIMARY KEY NOT NULL,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL REFERENCES question_sources(id) ON DELETE RESTRICT,
  source_sequence INTEGER CHECK(source_sequence IS NULL OR source_sequence >= 1),
  material_group_key TEXT,
  relation_role TEXT NOT NULL CHECK(relation_role IN ('original', 'reference', 'calibration')),
  calibration_role TEXT NOT NULL CHECK(calibration_role IN (
    'none', 'anchor', 'style_reference', 'difficulty_reference', 'distribution_reference'
  )),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  UNIQUE(question_id, source_id, relation_role),
  UNIQUE(source_id, source_sequence, relation_role)
);

CREATE TABLE question_source_import_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL REFERENCES question_sources(id) ON DELETE RESTRICT,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash) >= 16),
  imported_question_count INTEGER NOT NULL CHECK(imported_question_count >= 0),
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
);

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
    'manual_text', 'structured_file', 'document_scan', 'image_ocr', 'web_research',
    'bundled', 'agent_created', 'system_generated'
  )),
  source_metadata_json TEXT NOT NULL,
  raw_payload_hash TEXT NOT NULL CHECK(length(raw_payload_hash) >= 16),
  status TEXT NOT NULL CHECK(status IN ('needs_confirmation', 'confirmed', 'published', 'rejected')),
  issues_json TEXT NOT NULL DEFAULT '[]',
  idempotency_key TEXT NOT NULL UNIQUE,
  published_question_set_id TEXT REFERENCES question_sets(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
);

CREATE TABLE question_import_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  draft_id TEXT NOT NULL REFERENCES question_import_drafts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK(sequence >= 1),
  raw_json TEXT NOT NULL,
  content_json TEXT,
  content_hash TEXT CHECK(content_hash IS NULL OR length(content_hash) >= 16),
  difficulty REAL NOT NULL CHECK(difficulty BETWEEN 0 AND 1),
  status TEXT NOT NULL CHECK(status IN ('ready', 'needs_confirmation', 'rejected', 'published')),
  issues_json TEXT NOT NULL DEFAULT '[]',
  published_question_id TEXT REFERENCES questions(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  UNIQUE(draft_id, sequence)
);

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

INSERT INTO question_sources SELECT * FROM question_sources_v26;
INSERT INTO question_import_drafts SELECT * FROM question_import_drafts_v26;
INSERT INTO question_source_links SELECT * FROM question_source_links_v26;
INSERT INTO question_source_import_receipts SELECT * FROM question_source_import_receipts_v26;
INSERT INTO question_import_candidates SELECT * FROM question_import_candidates_v26;
INSERT INTO question_import_publish_receipts SELECT * FROM question_import_publish_receipts_v26;

DROP TABLE question_import_publish_receipts_v26;
DROP TABLE question_import_candidates_v26;
DROP TABLE question_source_links_v26;
DROP TABLE question_source_import_receipts_v26;
DROP TABLE question_import_drafts_v26;
DROP TABLE question_sources_v26;

CREATE INDEX question_sources_catalog_idx
  ON question_sources(source_type, exam_type, exam_year, province, status);
CREATE INDEX question_source_links_question_idx
  ON question_source_links(question_id, relation_role);
CREATE INDEX question_source_links_source_idx
  ON question_source_links(source_id, source_sequence);
CREATE INDEX question_source_import_receipts_source_idx
  ON question_source_import_receipts(source_id, created_at DESC);
CREATE INDEX question_import_drafts_status_idx
  ON question_import_drafts(exam_cycle_id, status, updated_at DESC);
CREATE INDEX question_import_drafts_owner_idx
  ON question_import_drafts(owner_session_id, status, updated_at DESC);
CREATE INDEX question_import_candidates_draft_status_idx
  ON question_import_candidates(draft_id, status, sequence);

CREATE TRIGGER question_sources_official_immutable_update
BEFORE UPDATE ON question_sources
WHEN OLD.source_type = 'official' AND (
  NEW.identity_hash IS NOT OLD.identity_hash OR NEW.source_type IS NOT OLD.source_type OR
  NEW.provider IS NOT OLD.provider OR NEW.exam_type IS NOT OLD.exam_type OR
  NEW.exam_year IS NOT OLD.exam_year OR NEW.province IS NOT OLD.province OR
  NEW.exam_batch IS NOT OLD.exam_batch OR NEW.paper_name IS NOT OLD.paper_name OR
  NEW.section_name IS NOT OLD.section_name OR NEW.provenance_json IS NOT OLD.provenance_json OR
  NEW.import_method IS NOT OLD.import_method OR NEW.content_hash IS NOT OLD.content_hash OR
  NEW.source_version IS NOT OLD.source_version OR NEW.created_at IS NOT OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'official question source metadata is immutable');
END;

CREATE TRIGGER question_sources_official_immutable_delete
BEFORE DELETE ON question_sources
WHEN OLD.source_type = 'official'
BEGIN
  SELECT RAISE(ABORT, 'official question source cannot be deleted');
END;

CREATE TRIGGER official_question_link_immutable_update
BEFORE UPDATE ON question_source_links
WHEN OLD.relation_role = 'original' AND EXISTS(
  SELECT 1 FROM question_sources source
  WHERE source.id = OLD.source_id AND source.source_type = 'official'
)
BEGIN
  SELECT RAISE(ABORT, 'official question source link is immutable');
END;

CREATE TRIGGER official_question_link_immutable_delete
BEFORE DELETE ON question_source_links
WHEN OLD.relation_role = 'original' AND EXISTS(
  SELECT 1 FROM question_sources source
  WHERE source.id = OLD.source_id AND source.source_type = 'official'
)
BEGIN
  SELECT RAISE(ABORT, 'official question source link cannot be deleted');
END;

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
