import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import {
  TutorIndexedDb,
  TutorIndexedDbStore
} from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { CommandReceipt, CommandReceiptRepository } from '../contracts/CommandReceiptRepository';

export class IndexedDbCommandReceiptRepository implements CommandReceiptRepository {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly transactionScope: IndexedDbTransactionScope
  ) {}

  find(idempotencyKey: string): Promise<CommandReceipt | undefined> {
    return this.database.get<CommandReceipt>(TutorIndexedDbStore.CommandReceipts, idempotencyKey);
  }

  async append(receipt: CommandReceipt, context: TransactionContext): Promise<void> {
    this.transactionScope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.CommandReceipts,
      value: receipt
    });
  }
}
