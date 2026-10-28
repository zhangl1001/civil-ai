export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly sql: string;
  /** Runs around `sql` in the same transaction; not part of the checksum. */
  readonly guard?: MigrationGuard;
}

/** SQL that protects data a checksummed migration body can no longer be edited to protect. */
export interface MigrationGuard {
  readonly before: string;
  readonly after: string;
}
