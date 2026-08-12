ALTER TABLE learning_assets ADD COLUMN purpose TEXT
  CHECK(purpose IS NULL OR purpose IN ('practice','mock','true_question','legacy_unknown'));

UPDATE learning_assets
SET purpose = CASE
  WHEN json_extract(payload_json, '$.essayContext.purpose') = 'mock' THEN 'mock'
  WHEN json_extract(payload_json, '$.essayContext.purpose') = 'true_question'
    OR json_extract(payload_json, '$.essayContext.entryMode') = 'true' THEN 'true_question'
  WHEN json_extract(payload_json, '$.essayContext.purpose') = 'practice'
    OR json_extract(payload_json, '$.essayContext.entryMode') = 'tutor' THEN 'practice'
  WHEN EXISTS(
    SELECT 1 FROM tutor_agent_runs run
    WHERE run.id = learning_assets.source_agent_run_id
      AND json_extract(run.input_snapshot_json, '$.sourceId') LIKE 'mock:申论:%'
  ) THEN 'mock'
  WHEN EXISTS(
    SELECT 1 FROM tutor_agent_runs run
    WHERE run.id = learning_assets.source_agent_run_id
      AND json_extract(run.input_snapshot_json, '$.sourceId') LIKE 'essay:%'
  ) THEN 'practice'
  ELSE 'legacy_unknown'
END
WHERE kind = 'essay_question' AND purpose IS NULL;

CREATE INDEX learning_assets_purpose_timeline_idx
  ON learning_assets(exam_cycle_id,kind,purpose,status,updated_at DESC,version DESC,id DESC);
