CREATE TABLE data_maintenance_context (
  operation TEXT PRIMARY KEY NOT NULL CHECK(operation IN ('clear_learning_data')),
  enabled INTEGER NOT NULL CHECK(enabled IN (0, 1))
);

DROP TRIGGER IF EXISTS official_question_link_immutable_delete;

CREATE TRIGGER official_question_link_immutable_delete
BEFORE DELETE ON question_source_links
WHEN OLD.relation_role = 'original'
  AND EXISTS(
    SELECT 1 FROM question_sources source
    WHERE source.id = OLD.source_id AND source.source_type = 'official'
  )
  AND NOT EXISTS(
    SELECT 1 FROM data_maintenance_context context
    WHERE context.operation = 'clear_learning_data' AND context.enabled = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'official question source link cannot be deleted');
END;
