ALTER TABLE generation_specs
  ADD COLUMN source_agent_run_id TEXT REFERENCES tutor_agent_runs(id) ON DELETE SET NULL;

CREATE INDEX generation_specs_source_agent_run_idx
  ON generation_specs(source_agent_run_id, created_at DESC);
