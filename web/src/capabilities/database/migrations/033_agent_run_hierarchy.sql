ALTER TABLE tutor_agent_runs
  ADD COLUMN root_agent_run_id TEXT REFERENCES tutor_agent_runs(id) ON DELETE CASCADE;

ALTER TABLE tutor_agent_runs
  ADD COLUMN parent_agent_run_id TEXT REFERENCES tutor_agent_runs(id) ON DELETE CASCADE;

UPDATE tutor_agent_runs
SET root_agent_run_id = id
WHERE root_agent_run_id IS NULL;

CREATE INDEX tutor_agent_runs_root_status_idx
  ON tutor_agent_runs(root_agent_run_id, status, updated_at DESC);

CREATE INDEX tutor_agent_runs_parent_idx
  ON tutor_agent_runs(parent_agent_run_id, updated_at DESC);
