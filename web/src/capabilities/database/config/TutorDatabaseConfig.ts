export const TUTOR_DATABASE_NAME = 'zhangl-agent-tutor-v2';

export interface TutorDatabaseConfig {
  readonly name: typeof TUTOR_DATABASE_NAME;
  readonly version: number;
  readonly busyTimeoutMs: number;
  readonly lockWaitTimeoutMs: number;
  readonly nativeOperationTimeoutMs: number;
  readonly transactionDeadlineMs: number;
  readonly maintenanceTransactionDeadlineMs: number;
  readonly recoveryOperationTimeoutMs: number;
  readonly healthCheckIntervalMs: number;
  readonly journalMode: 'WAL';
  readonly foreignKeys: true;
}

export const tutorDatabaseConfig: TutorDatabaseConfig = {
  name: TUTOR_DATABASE_NAME,
  version: 1,
  busyTimeoutMs: 5_000,
  lockWaitTimeoutMs: 12_000,
  nativeOperationTimeoutMs: 15_000,
  transactionDeadlineMs: 20_000,
  maintenanceTransactionDeadlineMs: 120_000,
  recoveryOperationTimeoutMs: 2_000,
  healthCheckIntervalMs: 60_000,
  journalMode: 'WAL',
  foreignKeys: true
};
