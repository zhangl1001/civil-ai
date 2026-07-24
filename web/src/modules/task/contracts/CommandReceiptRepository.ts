import type { TransactionContext } from '@/capabilities/database/public';
import type { InstantMs } from '@/kernel/public';

export interface CommandReceipt {
  readonly idempotencyKey: string;
  readonly commandType: string;
  readonly resultResourceType: string;
  readonly resultResourceId: string;
  readonly completedAt: InstantMs;
}

export interface CommandReceiptRepository {
  find(idempotencyKey: string): Promise<CommandReceipt | undefined>;
  append(receipt: CommandReceipt, context: TransactionContext): Promise<void>;
}
