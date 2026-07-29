ALTER TABLE question_sets
  ADD COLUMN entry_mode TEXT NOT NULL DEFAULT 'tutor'
  CHECK(entry_mode IN ('tutor', 'self'));

UPDATE question_sets
SET entry_mode = CASE
  WHEN (SELECT json_extract(constraints_json, '$.entryMode') FROM generation_specs WHERE id = question_sets.generation_spec_id) = 'self' THEN 'self'
  WHEN (SELECT json_extract(constraints_json, '$.entryMode') FROM generation_specs WHERE id = question_sets.generation_spec_id) = 'tutor' THEN 'tutor'
  WHEN (SELECT json_extract(constraints_json, '$.source') FROM generation_specs WHERE id = question_sets.generation_spec_id) = 'custom' THEN 'self'
  ELSE 'tutor'
END;

CREATE INDEX question_sets_library_page_idx
  ON question_sets(exam_cycle_id, origin_type, entry_mode, created_at DESC, id DESC);
