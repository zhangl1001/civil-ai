import type { MigrationGuard } from './Migration';

export function guardedMigrationSql(sql: string, guard?: MigrationGuard): string {
  return guard ? `${guard.before}\n${sql}\n${guard.after}` : sql;
}

/**
 * 042 parks daily_plan_items and deletes them to rebuild daily_plan_blocks.
 * learning_progress.daily_plan_item_id is ON DELETE SET NULL (038), so that
 * delete silently unlinked every progress row from its plan item, both on the
 * normal upgrade and in the swallowed-migration repair every existing iOS
 * device runs. The links are stashed first and put back once the items return.
 */
export const learningProgressPlanLinkGuard: MigrationGuard = {
  before: `
    DROP TABLE IF EXISTS temp.learning_progress_plan_links_v42;
    CREATE TEMP TABLE learning_progress_plan_links_v42 AS
      SELECT id, daily_plan_item_id FROM learning_progress WHERE daily_plan_item_id IS NOT NULL;
  `,
  after: `
    UPDATE learning_progress
    SET daily_plan_item_id = (
      SELECT link.daily_plan_item_id FROM learning_progress_plan_links_v42 link
      WHERE link.id = learning_progress.id
    )
    WHERE id IN (
      SELECT link.id FROM learning_progress_plan_links_v42 link
      JOIN daily_plan_items item ON item.id = link.daily_plan_item_id
    );
    DROP TABLE learning_progress_plan_links_v42;
  `
};
