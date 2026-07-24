import type { SqlDatabase, SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type { InstantMs } from '@/kernel/public';
import type { CommandReceipt, CommandReceiptRepository } from '../contracts/CommandReceiptRepository';

interface CommandReceiptRow extends SqlRow {
  idempotency_key: string;
  command_type: string;
  result_resource_type: string;
  result_resource_id: string;
  completed_at: number;
}

export class SqliteCommandReceiptRepository implements CommandReceiptRepository {
  constructor(
    private readonly database: SqlDatabase,
    private readonly transactionScope: SqlTransactionScope
  ) {}

  async find(idempotencyKey: string): Promise<CommandReceipt | undefined> {
    const rows = await this.database.query<CommandReceiptRow>(
      'SELECT * FROM command_receipts WHERE idempotency_key = ? LIMIT 1',
      [idempotencyKey]
    );
    const row = rows[0];
    return row ? {
      idempotencyKey: row.idempotency_key,
      commandType: row.command_type,
      resultResourceType: row.result_resource_type,
      resultResourceId: row.result_resource_id,
      completedAt: row.completed_at as InstantMs
    } : undefined;
  }

  async append(receipt: CommandReceipt, context: TransactionContext): Promise<void> {
    await this.transactionScope.resolve(context).run(
      `INSERT INTO command_receipts(
        idempotency_key, command_type, result_resource_type, result_resource_id, completed_at
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        receipt.idempotencyKey,
        receipt.commandType,
        receipt.resultResourceType,
        receipt.resultResourceId,
        receipt.completedAt
      ]
    );
  }
}
