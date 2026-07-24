import type { TransactionContext, UnitOfWork } from '../../contracts/UnitOfWork';
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
  private commitTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly database: TutorIndexedDb,
    private readonly scope: IndexedDbTransactionScope
  ) {}

  async run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    const context = this.scope.bind();
    let result: T;
    try {
      result = await work(context);
    } catch (error) {
      this.scope.discard(context);
      throw error;
    }
    const operations = this.scope.release(context);
    await this.commitExclusive(() => this.database.writeBatch(operations));
    return result;
  }

  private async commitExclusive(work: () => Promise<void>): Promise<void> {
    const previous = this.commitTail;
    let release: (() => void) | undefined;
    this.commitTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await work();
    } finally {
      release?.();
    }
  }
}
