import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { SqlDatabase, SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId, InstantMs } from '@/kernel/public';
import type { LearningProgressRecord, LearningProgressRepository } from '../contracts/LearningProgressRepository';
import type { LearningProgressStatus, LearningResourceType } from '../domain/LearningProgressCodes';

interface LearningProgressRow extends SqlRow {
  id: string;
  exam_cycle_id: string;
  resource_type: LearningResourceType;
  resource_key: string;
  asset_id: string | null;
  capability_node_id: string | null;
  daily_plan_item_id: string | null;
  status: LearningProgressStatus;
  started_at: number;
  completed_at: number | null;
  updated_at: number;
}

export class SqliteLearningProgressRepository implements LearningProgressRepository {
  constructor(
    private readonly database: SqlDatabase,
    private readonly scope: SqlTransactionScope
  ) {}

  async save(progress: LearningProgressRecord, context: TransactionContext): Promise<void> {
    await this.scope.resolve(context).run(
      `INSERT INTO learning_progress(
         id,exam_cycle_id,resource_type,resource_key,asset_id,capability_node_id,daily_plan_item_id,
         status,started_at,completed_at,updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(exam_cycle_id,resource_type,resource_key) DO UPDATE SET
         asset_id=excluded.asset_id,
         capability_node_id=excluded.capability_node_id,
         daily_plan_item_id=excluded.daily_plan_item_id,
         status=excluded.status,
         completed_at=excluded.completed_at,
         updated_at=excluded.updated_at`,
      [
        progress.id,
        progress.examCycleId,
        progress.resourceType,
        progress.resourceKey,
        progress.assetId ?? null,
        progress.capabilityNodeId ?? null,
        progress.dailyPlanItemId ?? null,
        progress.status,
        progress.startedAt,
        progress.completedAt ?? null,
        progress.updatedAt
      ]
    );
  }

  async find(
    examCycleId: ExamCycleId,
    resourceType: LearningResourceType,
    resourceKey: string
  ): Promise<LearningProgressRecord | undefined> {
    const rows = await this.database.query<LearningProgressRow>(
      `SELECT * FROM learning_progress
       WHERE exam_cycle_id=? AND resource_type=? AND resource_key=? LIMIT 1`,
      [examCycleId, resourceType, resourceKey]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  async listByCycle(examCycleId: ExamCycleId): Promise<readonly LearningProgressRecord[]> {
    const rows = await this.database.query<LearningProgressRow>(
      'SELECT * FROM learning_progress WHERE exam_cycle_id=? ORDER BY updated_at DESC',
      [examCycleId]
    );
    return rows.map(mapRow);
  }
}

function mapRow(row: LearningProgressRow): LearningProgressRecord {
  return {
    id: row.id,
    examCycleId: row.exam_cycle_id as ExamCycleId,
    resourceType: row.resource_type,
    resourceKey: row.resource_key,
    assetId: row.asset_id ?? undefined,
    capabilityNodeId: row.capability_node_id ?? undefined,
    dailyPlanItemId: row.daily_plan_item_id ?? undefined,
    status: row.status,
    startedAt: row.started_at as InstantMs,
    completedAt: row.completed_at === null ? undefined : row.completed_at as InstantMs,
    updatedAt: row.updated_at as InstantMs
  };
}
