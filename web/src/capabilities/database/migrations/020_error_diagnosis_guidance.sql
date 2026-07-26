ALTER TABLE error_diagnoses
  ADD COLUMN dimensions_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE error_diagnoses
  ADD COLUMN correction_plan_json TEXT NOT NULL DEFAULT '{}';
