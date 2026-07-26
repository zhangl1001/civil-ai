ALTER TABLE question_sets
  ADD COLUMN practice_status TEXT NOT NULL DEFAULT 'not_started'
  CHECK(practice_status IN ('not_started', 'in_progress', 'completed'));

UPDATE question_sets
SET practice_status = 'completed'
WHERE EXISTS (
  SELECT 1
  FROM learning_sessions
  WHERE learning_sessions.question_set_id = question_sets.id
    AND learning_sessions.status = 'completed'
);

UPDATE question_sets
SET practice_status = 'in_progress'
WHERE practice_status = 'not_started'
  AND EXISTS (
    SELECT 1
    FROM learning_assets
    WHERE learning_assets.exam_cycle_id = question_sets.exam_cycle_id
      AND learning_assets.kind = 'practice_session_draft'
      AND learning_assets.business_key = 'question-set:' || question_sets.id
      AND learning_assets.status = 'draft'
  );

CREATE INDEX question_sets_cycle_practice_status_idx
  ON question_sets(exam_cycle_id, practice_status, created_at DESC);
