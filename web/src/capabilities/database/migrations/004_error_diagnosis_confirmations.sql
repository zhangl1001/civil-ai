ALTER TABLE generation_specs
  ADD COLUMN teaching_blueprint_id TEXT REFERENCES teaching_blueprints(id) ON DELETE SET NULL;

CREATE TABLE error_diagnosis_confirmations (
  id TEXT PRIMARY KEY NOT NULL,
  error_diagnosis_id TEXT NOT NULL REFERENCES error_diagnoses(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('confirm', 'reject', 'correct')),
  corrected_cause_code TEXT CHECK(corrected_cause_code IS NULL OR corrected_cause_code IN (
    'concept_gap', 'recognition_error', 'method_selection_error', 'reasoning_error',
    'calculation_error', 'evidence_extraction_error', 'trap_misjudgment',
    'time_management_error', 'careless_error', 'transfer_failure',
    'retention_failure', 'unknown'
  )),
  corrected_detail TEXT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user', 'system', 'tutor_ai')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  CHECK((action = 'correct' AND corrected_cause_code IS NOT NULL AND length(trim(corrected_detail)) >= 1)
    OR action <> 'correct'),
  CHECK((action <> 'correct' AND corrected_cause_code IS NULL AND corrected_detail IS NULL)
    OR action = 'correct')
);

CREATE INDEX error_diagnosis_confirmations_diagnosis_idx
  ON error_diagnosis_confirmations(error_diagnosis_id, created_at DESC, id DESC);

CREATE TABLE error_diagnosis_current_projection (
  error_diagnosis_id TEXT PRIMARY KEY NOT NULL REFERENCES error_diagnoses(id) ON DELETE CASCADE,
  latest_confirmation_id TEXT NOT NULL REFERENCES error_diagnosis_confirmations(id) ON DELETE RESTRICT,
  confirmation_status TEXT NOT NULL CHECK(confirmation_status IN ('confirmed', 'rejected', 'corrected')),
  effective_cause_code TEXT NOT NULL CHECK(effective_cause_code IN (
    'concept_gap', 'recognition_error', 'method_selection_error', 'reasoning_error',
    'calculation_error', 'evidence_extraction_error', 'trap_misjudgment',
    'time_management_error', 'careless_error', 'transfer_failure',
    'retention_failure', 'unknown'
  )),
  effective_detail TEXT NOT NULL CHECK(length(trim(effective_detail)) >= 1),
  updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
  version INTEGER NOT NULL CHECK(version >= 1)
);

CREATE INDEX error_diagnosis_projection_status_idx
  ON error_diagnosis_current_projection(confirmation_status, updated_at DESC);
