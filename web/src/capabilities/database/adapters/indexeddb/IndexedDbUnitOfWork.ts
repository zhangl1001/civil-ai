import type {
  TransactionContext,
  UnitOfWork,
  UnitOfWorkOptions
} from '../../contracts/UnitOfWork';
import type { IndexedDbWriteOperation } from './TutorIndexedDb';
import { TutorIndexedDb } from './TutorIndexedDb';

export class IndexedDbTransactionScope {
  private readonly batches = new WeakMap<TransactionContext, IndexedDbWriteOperation[]>();

  bind(): TransactionContext {
    const context = {} as TransactionContext;
    this.batches.set(context, []);
    return context;
  }

  stage(context: TransactionContext, operation: IndexedDbWriteOperation): void {
    const batch = this.batches.get(context);
    if (!batch) throw new Error('Transaction context is not active in this IndexedDB runtime');
    batch.push(operation);
  }

  release(context: TransactionContext): readonly IndexedDbWriteOperation[] {
    const batch = this.batches.get(context);
    this.batches.delete(context);
    if (!batch) throw new Error('Transaction context is not active in this IndexedDB runtime');
    return batch;
  }

  discard(context: TransactionContext): void {
    this.batches.delete(context);
  }
}

export class IndexedDbUnitOfWork implements UnitOfWork {
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly database: TutorIndexedDb,
    private readonly scope: IndexedDbTransactionScope
  ) {}

  async run<T>(
    work: (context: TransactionContext) => Promise<T>,
    _options?: UnitOfWorkOptions
  ): Promise<T> {
    const previous = this.transactionTail;
    let release: (() => void) | undefined;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const context = this.scope.bind();
      try {
        const result = await work(context);
        await this.database.writeBatch(this.scope.release(context));
        return result;
      } catch (error) {
        this.scope.discard(context);
        throw error;
      }
    } finally {
      release?.();
    }
  }

  runAutocommit<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    // IndexedDB requires a browser transaction for writes; retain the same atomic batch semantics.
    return this.run(work);
  }
}
