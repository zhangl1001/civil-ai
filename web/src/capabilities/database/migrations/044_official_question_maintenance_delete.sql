-- Clearing or restoring learning data deletes the cycle's question sets, and
-- that cascades to their questions. The official-question delete guard from 022
-- had no maintenance exemption, so a cycle holding imported official questions
-- could be neither cleared nor restored from a backup: the cascade aborted the
-- whole maintenance transaction. Give it the same exemption 036 gave the
-- official source links; outside maintenance an official question stays
-- undeletable.
DROP TRIGGER IF EXISTS official_question_immutable_delete;

CREATE TRIGGER official_question_immutable_delete
BEFORE DELETE ON questions
WHEN OLD.is_official = 1
  AND NOT EXISTS(
    SELECT 1 FROM data_maintenance_context context
    WHERE context.operation = 'clear_learning_data' AND context.enabled = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'official question cannot be deleted');
END;
