CREATE TABLE question_reference_packs (
  id TEXT PRIMARY KEY NOT NULL,
  exam_cycle_id TEXT NOT NULL REFERENCES exam_cycles(id) ON DELETE RESTRICT,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  module TEXT NOT NULL,
  exam_scope_json TEXT NOT NULL,
  source_question_count INTEGER NOT NULL CHECK(source_question_count >= 1),
  source_set_count INTEGER NOT NULL CHECK(source_set_count >= 1),
  source_ids_json TEXT NOT NULL,
  question_type_distribution_json TEXT NOT NULL,
  difficulty_distribution_json TEXT NOT NULL,
  structural_distribution_json TEXT NOT NULL,
  distractor_patterns_json TEXT NOT NULL,
  representative_questions_json TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE CHECK(length(content_hash) >= 16),
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
);

CREATE INDEX question_reference_packs_scope_idx
  ON question_reference_packs(exam_cycle_id, capability_node_id, created_at DESC);
