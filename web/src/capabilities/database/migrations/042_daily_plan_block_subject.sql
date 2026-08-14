-- Daily plan blocks constrained subject to the civil-service codes, so an exam
-- package naming its subjects anything else could not have a plan written for
-- it at all: the database rejected the row. Which subjects exist belongs to the
-- installed package, so the column now only requires a non-empty code.
--
-- Only daily_plan_blocks changes shape. daily_plan_items is deliberately left
-- in place: renaming it would make SQLite rewrite its foreign key to point at
-- the temporary table this migration drops. Its rows are parked instead.
PRAGMA defer_foreign_keys = ON;

CREATE TEMP TABLE daily_plan_items_v41 AS SELECT * FROM daily_plan_items;
DELETE FROM daily_plan_items;

CREATE TABLE daily_plan_blocks_v42 (
  id TEXT PRIMARY KEY NOT NULL,
  daily_plan_id TEXT NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  subject TEXT NOT NULL CHECK(length(subject) > 0),
  module TEXT NOT NULL,
  teaching_goal_code TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence >= 1),
  priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 100),
  required INTEGER NOT NULL CHECK(required IN (0,1)),
  UNIQUE(daily_plan_id, sequence)
);

INSERT INTO daily_plan_blocks_v42
  SELECT id, daily_plan_id, capability_node_id, subject, module, teaching_goal_code,
         sequence, priority, required
  FROM daily_plan_blocks;

DROP TABLE daily_plan_blocks;
ALTER TABLE daily_plan_blocks_v42 RENAME TO daily_plan_blocks;

INSERT INTO daily_plan_items SELECT * FROM daily_plan_items_v41;
DROP TABLE daily_plan_items_v41;

CREATE INDEX daily_plan_blocks_plan_idx ON daily_plan_blocks(daily_plan_id, sequence);
