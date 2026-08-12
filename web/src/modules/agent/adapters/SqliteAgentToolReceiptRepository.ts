import type { SqlDatabase, SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { AgentRunId, InstantMs } from '@/kernel/public';
import {
  type AgentToolReceipt,
  type AgentToolReceiptMutationGuard,
  type AgentToolReceiptRepository,
  type AgentToolReceiptStatus
} from '../contracts/AgentToolReceiptRepository';

interface AgentToolReceiptRow extends SqlRow {
  agent_run_id: string;
  tool_call_id: string;
  tool_name: string;
  arguments_hash: string;
  business_idempotency_key: string;
  status: string;
  result_json: string | null;
  result_ref: string | null;
  failure_code: string | null;
  retryable: number;
  attempt_count: number;
  lease_epoch: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  version: number;
}

export class SqliteAgentToolReceiptRepository implements AgentToolReceiptRepository {
  constructor(private readonly database: SqlDatabase) {}

  async claim(receipt: AgentToolReceipt): Promise<AgentToolReceipt> {
    await this.database.run(
      `INSERT OR IGNORE INTO agent_tool_receipts(
        agent_run_id, tool_call_id, tool_name, arguments_hash, business_idempotency_key,
        status, result_json, result_ref, failure_code, retryable, attempt_count,
        lease_epoch, created_at, updated_at, completed_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      valuesOf(receipt)
    );
    const rows = await this.database.query<AgentToolReceiptRow>(
      `SELECT * FROM agent_tool_receipts
       WHERE agent_run_id = ? AND tool_call_id = ? LIMIT 1`,
      [receipt.agentRunId, receipt.toolCallId]
    );
    if (!rows[0]) throw new Error('Agent tool receipt claim failed');
    return fromRow(rows[0]);
  }

  async replace(
    receipt: AgentToolReceipt,
    expectedVersion: number,
    guard?: AgentToolReceiptMutationGuard
  ): Promise<void> {
    if (receipt.version !== expectedVersion + 1) {
      throw new Error('Agent tool receipt transition conflict');
    }
    const leasePredicate = guard
      ? ` AND EXISTS (
          SELECT 1 FROM tutor_agent_runs run
          WHERE run.id = agent_tool_receipts.agent_run_id
            AND run.status = 'running'
            AND run.lease_owner = ?
            AND run.lease_epoch = ?
            AND run.lease_expires_at > ?
        )`
      : '';
    const result = await this.database.run(
      `UPDATE agent_tool_receipts SET
        status = ?, result_json = ?, result_ref = ?, failure_code = ?, retryable = ?,
        attempt_count = ?, lease_epoch = ?, updated_at = ?, completed_at = ?, version = ?
       WHERE agent_run_id = ? AND tool_call_id = ? AND tool_name = ?
         AND arguments_hash = ? AND business_idempotency_key = ?
         AND version = ?${leasePredicate}`,
      [
        receipt.status,
        receipt.resultJson ?? null,
        receipt.resultRef ?? null,
        receipt.failureCode ?? null,
        receipt.retryable ? 1 : 0,
        receipt.attemptCount,
        receipt.leaseEpoch,
        receipt.updatedAt,
        receipt.completedAt ?? null,
        receipt.version,
        receipt.agentRunId,
        receipt.toolCallId,
        receipt.toolName,
        receipt.argumentsHash,
        receipt.businessIdempotencyKey,
        expectedVersion,
        ...(guard
          ? [guard.leaseToken.workerId, guard.leaseToken.leaseEpoch, guard.now]
          : [])
      ]
    );
    if (result.changes !== 1) throw new Error('Agent tool receipt transition conflict');
  }
}

function valuesOf(receipt: AgentToolReceipt) {
  return [
    receipt.agentRunId,
    receipt.toolCallId,
    receipt.toolName,
    receipt.argumentsHash,
    receipt.businessIdempotencyKey,
    receipt.status,
    receipt.resultJson ?? null,
    receipt.resultRef ?? null,
    receipt.failureCode ?? null,
    receipt.retryable ? 1 : 0,
    receipt.attemptCount,
    receipt.leaseEpoch,
    receipt.createdAt,
    receipt.updatedAt,
    receipt.completedAt ?? null,
    receipt.version
  ] as const;
}

function fromRow(row: AgentToolReceiptRow): AgentToolReceipt {
  return {
    agentRunId: row.agent_run_id as AgentRunId,
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    argumentsHash: row.arguments_hash,
    businessIdempotencyKey: row.business_idempotency_key,
    status: row.status as AgentToolReceiptStatus,
    resultJson: row.result_json ?? undefined,
    resultRef: row.result_ref ?? undefined,
    failureCode: row.failure_code ?? undefined,
    retryable: row.retryable === 1,
    attemptCount: row.attempt_count,
    leaseEpoch: row.lease_epoch,
    createdAt: row.created_at as InstantMs,
    updatedAt: row.updated_at as InstantMs,
    completedAt: row.completed_at === null ? undefined : row.completed_at as InstantMs,
    version: row.version
  };
}
