ALTER TABLE question_reference_packs
  ADD COLUMN comparison_questions_json TEXT NOT NULL DEFAULT '[]';
