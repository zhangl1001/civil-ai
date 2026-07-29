ALTER TABLE tutor_agent_runs
  ADD COLUMN execution_class TEXT NOT NULL DEFAULT 'general'
  CHECK(execution_class IN ('general', 'external_research'));

UPDATE tutor_agent_runs
SET execution_class = 'external_research'
WHERE target_resource_type = 'business_operation'
  AND json_extract(input_snapshot_json, '$.intent') = 'trueQuestionResearch';

CREATE INDEX tutor_agent_runs_execution_schedule_idx
  ON tutor_agent_runs(execution_class, status, next_run_at, updated_at);
