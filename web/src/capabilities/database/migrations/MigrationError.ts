export const MigrationErrorCode = {
  InvalidPlan: 'database.migration.invalid_plan',
  ChecksumMismatch: 'database.migration.checksum_mismatch',
  NewerDatabase: 'database.migration.newer_database'
} as const;

export type MigrationErrorCode = typeof MigrationErrorCode[keyof typeof MigrationErrorCode];

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;

  constructor(code: MigrationErrorCode, message: string) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
  }
}
