import type { SqlDatabase, SqlTransaction } from '../../contracts/SqlDatabase';
import type { TransactionContext, UnitOfWork } from '../../contracts/UnitOfWork';

export class SqlTransactionScope {
  private readonly transactions = new WeakMap<TransactionContext, SqlTransaction>();

  bind(transaction: SqlTransaction): TransactionContext {
    const context = {} as TransactionContext;
    this.transactions.set(context, transaction);
    return context;
  }

  resolve(context: TransactionContext): SqlTransaction {
    const transaction = this.transactions.get(context);
    if (!transaction) throw new Error('Transaction context is not active in this database runtime');
    return transaction;
  }

  release(context: TransactionContext): void {
    this.transactions.delete(context);
  }
}

export class SqlUnitOfWork implements UnitOfWork {
  constructor(
    private readonly database: SqlDatabase,
    private readonly scope: SqlTransactionScope
  ) {}

  run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const context = this.scope.bind(transaction);
      try {
        return await work(context);
      } finally {
        this.scope.release(context);
      }
    });
  }
}
