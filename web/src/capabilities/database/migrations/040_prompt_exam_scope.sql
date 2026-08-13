-- Prompt codes were globally unique, so two exam packs could not each ship their
-- own wording for the same task. Scope a definition to the pack that owns it and
-- keep 'shared' for prompts every pack reuses. Resolution prefers the active
-- pack and falls back to 'shared', so a pack overrides only what it needs.
--
-- Only prompt_definitions changes shape. prompt_versions is deliberately left
-- in place: renaming it would make SQLite rewrite the foreign keys in
-- generation_specs, question_sets and tutor_agent_runs to point at the
-- temporary table this migration drops. Its rows are parked instead, because
-- ON DELETE RESTRICT is enforced immediately even under deferred constraints.
PRAGMA defer_foreign_keys = ON;

CREATE TEMP TABLE prompt_versions_v39 AS SELECT * FROM prompt_versions;
DELETE FROM prompt_versions;

CREATE TABLE prompt_definitions_v40 (
  id TEXT PRIMARY KEY NOT NULL,
  exam_type TEXT NOT NULL DEFAULT 'shared' CHECK(length(exam_type) > 0),
  prompt_code TEXT NOT NULL,
  task_type TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'retired')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  UNIQUE(exam_type, prompt_code)
);

INSERT INTO prompt_definitions_v40(id, exam_type, prompt_code, task_type, description, status, created_at)
  SELECT id, 'shared', prompt_code, task_type, description, status, created_at FROM prompt_definitions;

DROP TABLE prompt_definitions;
ALTER TABLE prompt_definitions_v40 RENAME TO prompt_definitions;

INSERT INTO prompt_versions SELECT * FROM prompt_versions_v39;
DROP TABLE prompt_versions_v39;

CREATE INDEX prompt_definitions_code_idx ON prompt_definitions(prompt_code, exam_type);
