declare const transactionContext: unique symbol;

export interface TransactionContext {
  readonly [transactionContext]: true;
}

export const TransactionWorkload = {
  Core: 'core',
  Maintenance: 'maintenance'
} as const;

export type TransactionWorkload = typeof TransactionWorkload[keyof typeof TransactionWorkload];

export interface UnitOfWorkOptions {
  readonly workload?: TransactionWorkload;
}

export interface UnitOfWork {
  run<T>(work: (context: TransactionContext) => Promise<T>, options?: UnitOfWorkOptions): Promise<T>;
  runAutocommit<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}
