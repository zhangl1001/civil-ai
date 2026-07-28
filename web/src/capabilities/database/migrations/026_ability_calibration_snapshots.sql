CREATE TABLE ability_calibration_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE RESTRICT,
  algorithm_version TEXT NOT NULL,
  evidence_cutoff_at INTEGER NOT NULL CHECK(evidence_cutoff_at >= 0),
  input_fingerprint TEXT NOT NULL UNIQUE,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
);

CREATE INDEX ability_calibration_snapshots_cycle_idx
  ON ability_calibration_snapshots(exam_cycle_id, created_at DESC);
