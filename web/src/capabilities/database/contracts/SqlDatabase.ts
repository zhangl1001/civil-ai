export type SqlValue = string | number | null | Uint8Array;
export type SqlParameters = readonly SqlValue[];

export interface SqlRow {
  readonly [column: string]: unknown;
}

export interface SqlRunResult {
  readonly changes: number;
  readonly lastInsertId?: number;
}

export interface SqlBatchStatement {
  readonly sql: string;
  readonly parameters?: SqlParameters;
}

export interface SqlTransaction {
  execute(sql: string): Promise<void>;
  run(sql: string, parameters?: SqlParameters): Promise<SqlRunResult>;
  runBatch?(statements: readonly SqlBatchStatement[]): Promise<SqlRunResult>;
  query<Row extends SqlRow>(sql: string, parameters?: SqlParameters): Promise<readonly Row[]>;
}

export interface SqlDatabase extends SqlTransaction {
  open(): Promise<void>;
  close(): Promise<void>;
  transaction<T>(work: (transaction: SqlTransaction) => Promise<T>, options?: UnitOfWorkOptions): Promise<T>;
}
import type { UnitOfWorkOptions } from './UnitOfWork';
