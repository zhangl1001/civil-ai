import type { SqlDatabase, SqlRow, SqlTransaction } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type { CapabilityNodeId, ExamCycleId, InstantMs, JsonObject, LearningThreadEventId, LearningThreadId } from '@/kernel/public';
import type {
  LearningThreadAggregate,
  LearningThreadEventRecord,
  LearningThreadRecord,
  LearningThreadRepository
} from '../contracts/LearningThreadRepository';
import type { LearningThreadStage } from '../domain/LearningThreadStage';
import type { LearningThreadEventType, LearningThreadOrigin, LearningThreadStatus } from '../domain/LearningThreadCodes';

interface ThreadRow extends SqlRow {
  id: string; exam_cycle_id: string; primary_capability_node_id: string; origin_type: LearningThreadOrigin;
  origin_ref_id: string | null; goal: string; gap_snapshot_json: string; stage: LearningThreadStage;
  status: LearningThreadStatus; exit_criteria_json: string; next_action_json: string | null;
  started_at: number; paused_at: number | null; completed_at: number | null; closed_reason: string | null;
  version: number; created_at: number; updated_at: number;
}

interface EventRow extends SqlRow {
  id: string; learning_thread_id: string; exam_cycle_id: string; event_type: LearningThreadEventType;
  from_stage: LearningThreadStage | null; to_stage: LearningThreadStage | null; reason_code: string;
  payload_json: string; occurred_at: number; idempotency_key: string;
}

export class SqliteLearningThreadRepository implements LearningThreadRepository {
  constructor(private readonly database: SqlDatabase, private readonly transactionScope: SqlTransactionScope) {}

  async create(
    thread: LearningThreadRecord,
    event: LearningThreadEventRecord,
    context: TransactionContext
  ): Promise<void> {
    const transaction = this.transactionScope.resolve(context);
    await insertThread(transaction, thread);
    await insertEvent(transaction, event);
  }

  async replace(
    thread: LearningThreadRecord,
    expectedVersion: number,
    event: LearningThreadEventRecord,
    context: TransactionContext
  ): Promise<void> {
    if (thread.version !== expectedVersion + 1) throw new Error('Learning thread version must advance by one');
    const transaction = this.transactionScope.resolve(context);
    const result = await transaction.run(
      `UPDATE learning_threads SET stage = ?, status = ?, exit_criteria_json = ?, next_action_json = ?,
        paused_at = ?, completed_at = ?, closed_reason = ?, updated_at = ?, version = ?
       WHERE id = ? AND version = ?`,
      [thread.stage, thread.status, JSON.stringify(thread.exitCriteria),
        thread.nextAction ? JSON.stringify(thread.nextAction) : null, thread.pausedAt ?? null,
        thread.completedAt ?? null, thread.closedReason ?? null, thread.updatedAt,
        thread.version, thread.id, expectedVersion]
    );
    if (result.changes !== 1) throw new Error(`Learning thread version conflict: ${thread.id}`);
    await insertEvent(transaction, event);
  }

  async findById(threadId: LearningThreadId): Promise<LearningThreadAggregate | undefined> {
    const rows = await this.database.query<ThreadRow>('SELECT * FROM learning_threads WHERE id = ? LIMIT 1', [threadId]);
    return rows[0] ? this.load(rows[0]) : undefined;
  }

  async findOpen(examCycleId: ExamCycleId, capabilityNodeId: CapabilityNodeId): Promise<LearningThreadAggregate | undefined> {
    const rows = await this.database.query<ThreadRow>(
      `SELECT * FROM learning_threads
       WHERE exam_cycle_id = ? AND primary_capability_node_id = ? AND status IN ('active', 'paused')
       ORDER BY updated_at DESC LIMIT 1`,
      [examCycleId, capabilityNodeId]
    );
    return rows[0] ? this.load(rows[0]) : undefined;
  }

  async findEventByIdempotencyKey(idempotencyKey: string): Promise<LearningThreadEventRecord | undefined> {
    const rows = await this.database.query<EventRow>(
      'SELECT * FROM learning_thread_events WHERE idempotency_key = ? LIMIT 1', [idempotencyKey]
    );
    return rows[0] ? mapEvent(rows[0]) : undefined;
  }

  private async load(row: ThreadRow): Promise<LearningThreadAggregate> {
    const events = await this.database.query<EventRow>(
      'SELECT * FROM learning_thread_events WHERE learning_thread_id = ? ORDER BY occurred_at, id',
      [row.id]
    );
    return { thread: mapThread(row), events: events.map(mapEvent) };
  }
}

function insertThread(transaction: SqlTransaction, value: LearningThreadRecord): Promise<unknown> {
  return transaction.run(
    `INSERT INTO learning_threads(
      id, exam_cycle_id, primary_capability_node_id, origin_type, origin_ref_id, goal,
      gap_snapshot_json, stage, status, exit_criteria_json, next_action_json, started_at,
      paused_at, completed_at, closed_reason, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [value.id, value.examCycleId, value.primaryCapabilityNodeId, value.originType, value.originRefId ?? null,
      value.goal, JSON.stringify(value.gapSnapshot), value.stage, value.status, JSON.stringify(value.exitCriteria),
      value.nextAction ? JSON.stringify(value.nextAction) : null, value.startedAt, value.pausedAt ?? null,
      value.completedAt ?? null, value.closedReason ?? null, value.version, value.createdAt, value.updatedAt]
  );
}

function insertEvent(transaction: SqlTransaction, value: LearningThreadEventRecord): Promise<unknown> {
  return transaction.run(
    `INSERT INTO learning_thread_events(
      id, learning_thread_id, exam_cycle_id, event_type, from_stage, to_stage,
      reason_code, payload_json, occurred_at, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [value.id, value.learningThreadId, value.examCycleId, value.eventType, value.fromStage ?? null,
      value.toStage ?? null, value.reasonCode, JSON.stringify(value.payload), value.occurredAt, value.idempotencyKey]
  );
}

function mapThread(row: ThreadRow): LearningThreadRecord {
  return {
    id: row.id as LearningThreadId,
    examCycleId: row.exam_cycle_id as ExamCycleId,
    primaryCapabilityNodeId: row.primary_capability_node_id as CapabilityNodeId,
    originType: row.origin_type,
    originRefId: row.origin_ref_id ?? undefined,
    goal: row.goal,
    gapSnapshot: parseObject(row.gap_snapshot_json, 'learning_threads.gap_snapshot_json'),
    stage: row.stage,
    status: row.status,
    exitCriteria: parseObject(row.exit_criteria_json, 'learning_threads.exit_criteria_json'),
    nextAction: row.next_action_json ? parseObject(row.next_action_json, 'learning_threads.next_action_json') : undefined,
    startedAt: row.started_at as InstantMs,
    pausedAt: row.paused_at as InstantMs | null ?? undefined,
    completedAt: row.completed_at as InstantMs | null ?? undefined,
    closedReason: row.closed_reason ?? undefined,
    version: row.version,
    createdAt: row.created_at as InstantMs,
    updatedAt: row.updated_at as InstantMs
  };
}

function mapEvent(row: EventRow): LearningThreadEventRecord {
  return {
    id: row.id as LearningThreadEventId,
    learningThreadId: row.learning_thread_id as LearningThreadId,
    examCycleId: row.exam_cycle_id as ExamCycleId,
    eventType: row.event_type,
    fromStage: row.from_stage ?? undefined,
    toStage: row.to_stage ?? undefined,
    reasonCode: row.reason_code,
    payload: parseObject(row.payload_json, 'learning_thread_events.payload_json'),
    occurredAt: row.occurred_at as InstantMs,
    idempotencyKey: row.idempotency_key
  };
}

function parseObject(value: string, field: string): JsonObject {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError(`${field} must be an object`);
  return parsed as JsonObject;
}
