CREATE TABLE local_data_maintenance_guard (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton = 1),
  allow_immutable_deletes INTEGER NOT NULL DEFAULT 0 CHECK(allow_immutable_deletes IN (0, 1))
);

INSERT INTO local_data_maintenance_guard(singleton, allow_immutable_deletes)
VALUES (1, 0);

DROP TRIGGER IF EXISTS official_question_immutable_delete;

CREATE TRIGGER official_question_immutable_delete
BEFORE DELETE ON questions
WHEN OLD.is_official = 1
  AND COALESCE((SELECT allow_immutable_deletes FROM local_data_maintenance_guard WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'official question cannot be deleted');
END;

DROP TRIGGER IF EXISTS official_question_link_immutable_delete;

CREATE TRIGGER official_question_link_immutable_delete
BEFORE DELETE ON question_source_links
WHEN OLD.relation_role = 'original'
  AND EXISTS(
    SELECT 1 FROM question_sources source
    WHERE source.id = OLD.source_id AND source.source_type = 'official'
  )
  AND COALESCE((SELECT allow_immutable_deletes FROM local_data_maintenance_guard WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'official question source link cannot be deleted');
END;

DROP TRIGGER IF EXISTS question_sources_official_immutable_delete;

CREATE TRIGGER question_sources_official_immutable_delete
BEFORE DELETE ON question_sources
WHEN OLD.source_type = 'official'
  AND COALESCE((SELECT allow_immutable_deletes FROM local_data_maintenance_guard WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'official question source cannot be deleted');
END;
