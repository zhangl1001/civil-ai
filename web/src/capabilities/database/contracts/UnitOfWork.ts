declare const transactionContext: unique symbol;

export interface TransactionContext {
  readonly [transactionContext]: true;
}

export interface UnitOfWork {
  run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}
