CREATE TABLE daily_plan_blocks (
  id TEXT PRIMARY KEY NOT NULL,
  daily_plan_id TEXT NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  capability_node_id TEXT NOT NULL REFERENCES capability_nodes(id) ON DELETE RESTRICT,
  subject TEXT NOT NULL CHECK(subject IN ('aptitude','essay','interview')),
  module TEXT NOT NULL,
  teaching_goal_code TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence >= 1),
  priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 100),
  required INTEGER NOT NULL CHECK(required IN (0,1)),
  UNIQUE(daily_plan_id, sequence)
);

CREATE INDEX daily_plan_blocks_plan_idx
  ON daily_plan_blocks(daily_plan_id, sequence);

ALTER TABLE daily_plan_items ADD COLUMN daily_plan_block_id TEXT
  REFERENCES daily_plan_blocks(id) ON DELETE CASCADE;
ALTER TABLE daily_plan_items ADD COLUMN item_category TEXT NOT NULL DEFAULT 'practice'
  CHECK(item_category IN ('learn','practice','review','assess','accumulate'));
ALTER TABLE daily_plan_items ADD COLUMN priority INTEGER NOT NULL DEFAULT 50
  CHECK(priority BETWEEN 0 AND 100);
ALTER TABLE daily_plan_items ADD COLUMN required INTEGER NOT NULL DEFAULT 1
  CHECK(required IN (0,1));
ALTER TABLE daily_plan_items ADD COLUMN dependency_ids_json TEXT NOT NULL DEFAULT '[]';

INSERT INTO daily_plan_blocks(
  id, daily_plan_id, capability_node_id, subject, module,
  teaching_goal_code, sequence, priority, required
)
SELECT
  'DailyPlanBlockId:legacy:' || item.daily_plan_id || ':' || MIN(item.sequence),
  item.daily_plan_id,
  item.capability_node_id,
  node.subject,
  node.module,
  'legacy_plan_item',
  MIN(item.sequence),
  50,
  1
FROM daily_plan_items item
JOIN capability_nodes node ON node.id = item.capability_node_id
GROUP BY item.daily_plan_id, item.capability_node_id, node.subject, node.module;

UPDATE daily_plan_items
SET daily_plan_block_id = (
  SELECT block.id
  FROM daily_plan_blocks block
  WHERE block.daily_plan_id = daily_plan_items.daily_plan_id
    AND block.capability_node_id = daily_plan_items.capability_node_id
  ORDER BY block.sequence
  LIMIT 1
),
item_category = CASE item_type
  WHEN 'lecture' THEN 'learn'
  WHEN 'review' THEN 'review'
  WHEN 'diagnosis' THEN 'assess'
  WHEN 'mock' THEN 'assess'
  WHEN 'digest' THEN 'accumulate'
  ELSE 'practice'
END;

CREATE INDEX daily_plan_items_block_idx
  ON daily_plan_items(daily_plan_block_id, sequence);
CREATE INDEX daily_plan_items_category_status_idx
  ON daily_plan_items(daily_plan_id, item_category, status, sequence);
