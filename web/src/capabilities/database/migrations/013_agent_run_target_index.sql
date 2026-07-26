CREATE INDEX tutor_agent_runs_target_status_idx
  ON tutor_agent_runs(target_resource_type, target_resource_id, status, updated_at DESC);
