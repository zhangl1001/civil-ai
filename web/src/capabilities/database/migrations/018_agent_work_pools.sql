ALTER TABLE tutor_agent_runs
  ADD COLUMN work_pool TEXT NOT NULL DEFAULT 'background'
  CHECK(work_pool IN ('content_generation', 'assessment', 'interactive', 'background'));

UPDATE tutor_agent_runs
SET work_pool = CASE
  WHEN run_type = 'content_generation' THEN 'content_generation'
  WHEN run_type = 'error_diagnosis' THEN 'assessment'
  WHEN run_type = 'tutor_turn' THEN 'interactive'
  ELSE 'background'
END;

CREATE INDEX tutor_agent_runs_pool_schedule_idx
  ON tutor_agent_runs(work_pool, status, next_run_at, updated_at);
