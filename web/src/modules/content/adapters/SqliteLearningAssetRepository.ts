import type { SqlDatabase, SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId, InstantMs, JsonObject } from '@/kernel/public';
import type {
  LearningAssetQuery,
  LearningAssetRecord,
  LearningAssetRepository
} from '../contracts/LearningAssetRepository';
import type { LearningAssetKind, LearningAssetPurpose, LearningAssetStatus } from '../domain/LearningAssetCodes';

interface LearningAssetRow extends SqlRow {
  id: string;
  exam_cycle_id: string;
  kind: LearningAssetKind;
  business_key: string;
  title: string;
  status: LearningAssetStatus;
  purpose: LearningAssetPurpose | null;
  payload_json: string;
  source_agent_run_id: string | null;
  version: number;
  created_at: number;
  updated_at: number;
}

export class SqliteLearningAssetRepository implements LearningAssetRepository {
  constructor(
    private readonly database: SqlDatabase,
    private readonly scope: SqlTransactionScope
  ) {}

  async save(asset: LearningAssetRecord, context: TransactionContext): Promise<void> {
    await this.scope.resolve(context).run(
      `INSERT INTO learning_assets(
        id,exam_cycle_id,kind,business_key,title,status,purpose,payload_json,source_agent_run_id,version,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        asset.id,
        asset.examCycleId,
        asset.kind,
        asset.businessKey,
        asset.title,
        asset.status,
        asset.purpose ?? null,
        JSON.stringify(asset.payload),
        asset.sourceAgentRunId ?? null,
        asset.version,
        asset.createdAt,
        asset.updatedAt
      ]
    );
  }

  async saveDraft(asset: LearningAssetRecord, context: TransactionContext): Promise<void> {
    await this.scope.resolve(context).run(
      `INSERT INTO learning_assets(
        id,exam_cycle_id,kind,business_key,title,status,purpose,payload_json,source_agent_run_id,version,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,status=excluded.status,purpose=excluded.purpose,payload_json=excluded.payload_json,
        source_agent_run_id=excluded.source_agent_run_id,updated_at=excluded.updated_at`,
      [
        asset.id,
        asset.examCycleId,
        asset.kind,
        asset.businessKey,
        asset.title,
        asset.status,
        asset.purpose ?? null,
        JSON.stringify(asset.payload),
        asset.sourceAgentRunId ?? null,
        asset.version,
        asset.createdAt,
        asset.updatedAt
      ]
    );
  }

  async find(id: string): Promise<LearningAssetRecord | undefined> {
    const rows = await this.database.query<LearningAssetRow>(
      'SELECT * FROM learning_assets WHERE id=? LIMIT 1',
      [id]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  async findLatest(
    examCycleId: ExamCycleId,
    kind: LearningAssetKind,
    businessKey: string
  ): Promise<LearningAssetRecord | undefined> {
    const rows = await this.database.query<LearningAssetRow>(
      `SELECT * FROM learning_assets
       WHERE exam_cycle_id=? AND kind=? AND business_key=? AND status<>'retired'
       ORDER BY version DESC,updated_at DESC,id DESC LIMIT 1`,
      [examCycleId, kind, businessKey]
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  async list(query: LearningAssetQuery): Promise<readonly LearningAssetRecord[]> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500) {
      throw new RangeError('Learning asset query limit must be between 1 and 500');
    }
    const offset = query.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0) throw new RangeError('Learning asset query offset must be a non-negative integer');
    const { conditions, parameters } = buildFilteredQuery(query);
    parameters.push(query.limit, offset);
    const rows = await this.database.query<LearningAssetRow>(
      query.latestPerBusinessKey
        ? `WITH ranked AS (
             SELECT asset.*,
               ROW_NUMBER() OVER (
                 PARTITION BY asset.exam_cycle_id,asset.kind,asset.business_key
                 ORDER BY asset.version DESC,asset.updated_at DESC,asset.id DESC
               ) AS asset_rank
             FROM learning_assets asset
             WHERE ${conditions.join(' AND ')}
           )
           SELECT * FROM ranked WHERE asset_rank=1
           ORDER BY updated_at DESC,version DESC,id DESC LIMIT ? OFFSET ?`
        : `SELECT asset.* FROM learning_assets asset WHERE ${conditions.join(' AND ')}
           ORDER BY asset.updated_at DESC,asset.version DESC,asset.id DESC LIMIT ? OFFSET ?`,
      parameters
    );
    return rows.map(mapRow);
  }

  async count(query: Omit<LearningAssetQuery, 'limit' | 'offset'>): Promise<number> {
    const { conditions, parameters } = buildFilteredQuery(query);
    const rows = await this.database.query<{ total: number } & SqlRow>(
      query.latestPerBusinessKey
        ? `SELECT COUNT(*) AS total FROM (
             SELECT ROW_NUMBER() OVER (
               PARTITION BY asset.exam_cycle_id,asset.kind,asset.business_key
               ORDER BY asset.version DESC,asset.updated_at DESC,asset.id DESC
             ) AS asset_rank
             FROM learning_assets asset
             WHERE ${conditions.join(' AND ')}
           ) ranked WHERE asset_rank=1`
        : `SELECT COUNT(*) AS total FROM learning_assets asset WHERE ${conditions.join(' AND ')}`,
      parameters
    );
    return Number(rows[0]?.total || 0);
  }

  async listAll(examCycleId: ExamCycleId): Promise<readonly LearningAssetRecord[]> {
    const rows = await this.database.query<LearningAssetRow>(
      'SELECT * FROM learning_assets WHERE exam_cycle_id=? ORDER BY updated_at DESC,version DESC,id DESC',
      [examCycleId]
    );
    return rows.map(mapRow);
  }

  async retire(id: string, updatedAt: InstantMs, context: TransactionContext): Promise<void> {
    await this.scope.resolve(context).run(
      "UPDATE learning_assets SET status='retired',updated_at=? WHERE id=? AND status<>'retired'",
      [updatedAt, id]
    );
  }

  async retireBusinessKey(
    examCycleId: ExamCycleId,
    kind: LearningAssetKind,
    businessKey: string,
    updatedAt: InstantMs,
    context: TransactionContext
  ): Promise<void> {
    await this.scope.resolve(context).run(
      `UPDATE learning_assets SET status='retired',updated_at=?
       WHERE exam_cycle_id=? AND kind=? AND business_key=? AND status<>'retired'`,
      [updatedAt, examCycleId, kind, businessKey]
    );
  }
}

function buildFilteredQuery(
  query: Pick<LearningAssetQuery, 'examCycleId' | 'kinds' | 'businessKey' | 'status' | 'purposes'>
): { conditions: string[]; parameters: Array<string | number> } {
  const conditions = ['asset.exam_cycle_id=?'];
  const parameters: Array<string | number> = [query.examCycleId];
  if (query.kinds?.length) {
    conditions.push(`asset.kind IN (${query.kinds.map(() => '?').join(',')})`);
    parameters.push(...query.kinds);
  }
  if (query.businessKey) {
    conditions.push('asset.business_key=?');
    parameters.push(query.businessKey);
  }
  if (query.status) {
    conditions.push('asset.status=?');
    parameters.push(query.status);
  }
  if (query.purposes?.length) {
    conditions.push(`asset.purpose IN (${query.purposes.map(() => '?').join(',')})`);
    parameters.push(...query.purposes);
  }
  return { conditions, parameters };
}

function mapRow(row: LearningAssetRow): LearningAssetRecord {
  return {
    id: row.id,
    examCycleId: row.exam_cycle_id as ExamCycleId,
    kind: row.kind,
    businessKey: row.business_key,
    title: row.title,
    status: row.status,
    purpose: row.purpose ?? undefined,
    payload: JSON.parse(row.payload_json) as JsonObject,
    sourceAgentRunId: row.source_agent_run_id ?? undefined,
    version: row.version,
    createdAt: row.created_at as InstantMs,
    updatedAt: row.updated_at as InstantMs
  };
}
