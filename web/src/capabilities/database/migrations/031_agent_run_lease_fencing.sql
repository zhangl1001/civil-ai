ALTER TABLE tutor_agent_runs
  ADD COLUMN lease_epoch INTEGER NOT NULL DEFAULT 0
  CHECK(lease_epoch >= 0);
