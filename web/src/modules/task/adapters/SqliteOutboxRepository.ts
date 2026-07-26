import type { SqlDatabase, SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type { InstantMs, JsonObject, OutboxEventId } from '@/kernel/public';
import type { ClaimOutboxOptions, OutboxEvent, OutboxRepository } from '../contracts/OutboxRepository';

interface OutboxRow extends SqlRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload_json: string;
  occurred_at: number;
  attempt_count: number;
  idempotency_key: string;
}

function parsePayload(serialized: string): JsonObject {
  const value: unknown = JSON.parse(serialized);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('domain_outbox.payload_json must contain a JSON object');
  }
  return value as JsonObject;
}

export class SqliteOutboxRepository implements OutboxRepository {
  constructor(
    private readonly database: SqlDatabase,
    private readonly transactionScope: SqlTransactionScope
  ) {}

  async append(event: OutboxEvent, context: TransactionContext): Promise<void> {
    await this.transactionScope.resolve(context).run(
      `INSERT INTO domain_outbox(
        id, aggregate_type, aggregate_id, event_type, payload_json,
        occurred_at, attempt_count, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        JSON.stringify(event.payload),
        event.occurredAt,
        event.attemptCount,
        event.idempotencyKey
      ]
    );
  }

  async claimPending(options: ClaimOutboxOptions): Promise<readonly OutboxEvent[]> {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
      throw new RangeError('Outbox claim limit must be an integer between 1 and 100');
    }
    if (options.leaseExpiresAt <= options.now) {
      throw new RangeError('Outbox lease must expire after claim time');
    }

    return this.database.transaction(async (transaction) => {
      const eventTypeClause = options.eventTypes?.length
        ? ` AND event_type IN (${options.eventTypes.map(() => '?').join(', ')})`
        : '';
      const candidates = await transaction.query<OutboxRow>(
        `SELECT id, aggregate_type, aggregate_id, event_type, payload_json,
                occurred_at, attempt_count, idempotency_key
         FROM domain_outbox
         WHERE published_at IS NULL
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           AND (claimed_by IS NULL OR claim_expires_at <= ?)
           ${eventTypeClause}
         ORDER BY occurred_at ASC
         LIMIT ?`,
        [options.now, options.now, ...(options.eventTypes ?? []), options.limit]
      );
      const claimed: OutboxEvent[] = [];
      for (const candidate of candidates) {
        const result = await transaction.run(
          `UPDATE domain_outbox
           SET claimed_by = ?, claim_expires_at = ?
           WHERE id = ? AND published_at IS NULL
             AND (claimed_by IS NULL OR claim_expires_at <= ?)`,
          [options.workerId, options.leaseExpiresAt, candidate.id, options.now]
        );
        if (result.changes === 1) claimed.push(this.mapEvent(candidate));
      }
      return claimed;
    });
  }

  async markPublished(
    eventId: OutboxEventId,
    workerId: string,
    publishedAt: InstantMs
  ): Promise<boolean> {
    const result = await this.database.run(
      `UPDATE domain_outbox
       SET published_at = ?, claimed_by = NULL, claim_expires_at = NULL, last_error_code = NULL
       WHERE id = ? AND published_at IS NULL AND claimed_by = ?`,
      [publishedAt, eventId, workerId]
    );
    return result.changes === 1;
  }

  async recordFailure(
    eventId: OutboxEventId,
    workerId: string,
    errorCode: string,
    nextAttemptAt: InstantMs
  ): Promise<boolean> {
    const result = await this.database.run(
      `UPDATE domain_outbox
       SET attempt_count = attempt_count + 1,
           next_attempt_at = ?, last_error_code = ?, claimed_by = NULL, claim_expires_at = NULL
       WHERE id = ? AND published_at IS NULL AND claimed_by = ?`,
      [nextAttemptAt, errorCode, eventId, workerId]
    );
    return result.changes === 1;
  }

  private mapEvent(row: OutboxRow): OutboxEvent {
    return {
      id: row.id as OutboxEventId,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      payload: parsePayload(row.payload_json),
      occurredAt: row.occurred_at as InstantMs,
      attemptCount: row.attempt_count,
      idempotencyKey: row.idempotency_key
    };
  }
}
