ALTER TABLE generation_specs
  ADD COLUMN reference_pack_id TEXT;

ALTER TABLE generation_specs
  ADD COLUMN reference_policy_version TEXT;

ALTER TABLE generation_specs
  ADD COLUMN generation_intent TEXT CHECK(
    generation_intent IS NULL OR generation_intent IN (
      'diagnostic_baseline',
      'targeted_training',
      'retention_review',
      'transfer_assessment',
      'true_question_calibration',
      'user_directed'
    )
  );

ALTER TABLE generation_specs
  ADD COLUMN calibration_target TEXT;

ALTER TABLE question_sets
  ADD COLUMN origin_type TEXT NOT NULL DEFAULT 'ai_generated' CHECK(
    origin_type IN (
      'official',
      'imported',
      'user_created',
      'ai_generated',
      'ai_variant',
      'diagnostic_anchor'
    )
  );

ALTER TABLE question_sets
  ADD COLUMN source_id TEXT;

ALTER TABLE question_sets
  ADD COLUMN calibration_role TEXT NOT NULL DEFAULT 'none' CHECK(
    calibration_role IN (
      'none',
      'anchor',
      'style_reference',
      'difficulty_reference',
      'distribution_reference'
    )
  );

ALTER TABLE questions
  ADD COLUMN origin_type TEXT NOT NULL DEFAULT 'ai_generated' CHECK(
    origin_type IN (
      'official',
      'imported',
      'user_created',
      'ai_generated',
      'ai_variant',
      'diagnostic_anchor'
    )
  );

ALTER TABLE questions
  ADD COLUMN source_id TEXT;

ALTER TABLE questions
  ADD COLUMN source_sequence INTEGER CHECK(source_sequence IS NULL OR source_sequence >= 1);

ALTER TABLE questions
  ADD COLUMN lineage_id TEXT;

ALTER TABLE questions
  ADD COLUMN calibration_role TEXT NOT NULL DEFAULT 'none' CHECK(
    calibration_role IN (
      'none',
      'anchor',
      'style_reference',
      'difficulty_reference',
      'distribution_reference'
    )
  );

ALTER TABLE questions
  ADD COLUMN is_official INTEGER NOT NULL DEFAULT 0 CHECK(is_official IN (0, 1));

CREATE TABLE question_sources (
  id TEXT PRIMARY KEY NOT NULL,
  identity_hash TEXT NOT NULL UNIQUE CHECK(length(identity_hash) >= 16),
  source_type TEXT NOT NULL CHECK(source_type IN (
    'official',
    'imported',
    'user_created',
    'ai_generated',
    'ai_variant',
    'diagnostic_anchor'
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
    'manual_text',
    'structured_file',
    'document_scan',
    'image_ocr',
    'bundled',
    'agent_created',
    'system_generated'
  )),
  content_hash TEXT NOT NULL UNIQUE CHECK(length(content_hash) >= 16),
  source_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'archived', 'rejected')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
);

CREATE INDEX question_sources_catalog_idx
  ON question_sources(source_type, exam_type, exam_year, province, status);

CREATE TABLE question_source_links (
  id TEXT PRIMARY KEY NOT NULL,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL REFERENCES question_sources(id) ON DELETE RESTRICT,
  source_sequence INTEGER CHECK(source_sequence IS NULL OR source_sequence >= 1),
  material_group_key TEXT,
  relation_role TEXT NOT NULL CHECK(relation_role IN ('original', 'reference', 'calibration')),
  calibration_role TEXT NOT NULL CHECK(calibration_role IN (
    'none',
    'anchor',
    'style_reference',
    'difficulty_reference',
    'distribution_reference'
  )),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  UNIQUE(question_id, source_id, relation_role),
  UNIQUE(source_id, source_sequence, relation_role)
);

CREATE INDEX question_source_links_question_idx
  ON question_source_links(question_id, relation_role);

CREATE INDEX question_source_links_source_idx
  ON question_source_links(source_id, source_sequence);

CREATE TABLE question_lineage (
  id TEXT PRIMARY KEY NOT NULL,
  question_id TEXT NOT NULL UNIQUE REFERENCES questions(id) ON DELETE RESTRICT,
  parent_question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  derivation_type TEXT NOT NULL CHECK(derivation_type IN (
    'variant',
    'difficulty_adjustment',
    'transfer',
    'repair'
  )),
  generation_workflow_id TEXT REFERENCES generation_workflows(id) ON DELETE SET NULL,
  reference_snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  CHECK(question_id <> parent_question_id)
);

CREATE INDEX question_lineage_parent_idx
  ON question_lineage(parent_question_id, derivation_type, created_at);

CREATE TABLE question_source_import_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL REFERENCES question_sources(id) ON DELETE RESTRICT,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash) >= 16),
  imported_question_count INTEGER NOT NULL CHECK(imported_question_count >= 0),
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
);

CREATE INDEX question_source_import_receipts_source_idx
  ON question_source_import_receipts(source_id, created_at DESC);

CREATE TRIGGER question_sources_official_immutable_update
BEFORE UPDATE ON question_sources
WHEN OLD.source_type = 'official' AND (
  NEW.identity_hash IS NOT OLD.identity_hash OR
  NEW.source_type IS NOT OLD.source_type OR
  NEW.provider IS NOT OLD.provider OR
  NEW.exam_type IS NOT OLD.exam_type OR
  NEW.exam_year IS NOT OLD.exam_year OR
  NEW.province IS NOT OLD.province OR
  NEW.exam_batch IS NOT OLD.exam_batch OR
  NEW.paper_name IS NOT OLD.paper_name OR
  NEW.section_name IS NOT OLD.section_name OR
  NEW.provenance_json IS NOT OLD.provenance_json OR
  NEW.import_method IS NOT OLD.import_method OR
  NEW.content_hash IS NOT OLD.content_hash OR
  NEW.source_version IS NOT OLD.source_version OR
  NEW.created_at IS NOT OLD.created_at
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

CREATE TRIGGER official_question_content_immutable_update
BEFORE UPDATE ON questions
WHEN OLD.is_official = 1 AND (
  NEW.content_json IS NOT OLD.content_json OR
  NEW.correct_answer_json IS NOT OLD.correct_answer_json OR
  NEW.content_hash IS NOT OLD.content_hash OR
  NEW.content_schema_version_id IS NOT OLD.content_schema_version_id OR
  NEW.question_template_version_id IS NOT OLD.question_template_version_id OR
  NEW.source_id IS NOT OLD.source_id OR
  NEW.source_sequence IS NOT OLD.source_sequence OR
  NEW.is_official IS NOT OLD.is_official
)
BEGIN
  SELECT RAISE(ABORT, 'official question content is immutable');
END;

CREATE TRIGGER official_question_immutable_delete
BEFORE DELETE ON questions
WHEN OLD.is_official = 1
BEGIN
  SELECT RAISE(ABORT, 'official question cannot be deleted');
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
