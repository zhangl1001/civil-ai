import type { SqlDatabase, SqlRow } from '../contracts/SqlDatabase';
import type { TutorDatabaseConfig } from '../config/TutorDatabaseConfig';
import type { Migration } from './Migration';
import { MigrationError, MigrationErrorCode } from './MigrationError';

interface AppliedMigrationRow extends SqlRow {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

const createMigrationTableSql = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  );
`;

export class MigrationRunner {
  private migrationPromise: Promise<void> | undefined;

  constructor(
    private readonly database: SqlDatabase,
    private readonly config: TutorDatabaseConfig,
    private readonly migrations: readonly Migration[]
  ) {}

  migrate(nowEpochMs: number): Promise<void> {
    if (!this.migrationPromise) {
      this.migrationPromise = this.runMigrations(nowEpochMs).catch((error: unknown) => {
        this.migrationPromise = undefined;
        throw error;
      });
    }
    return this.migrationPromise;
  }

  private async runMigrations(nowEpochMs: number): Promise<void> {
    this.validatePlan();
    await this.database.open();
    await this.configureConnection();
    await this.database.execute(createMigrationTableSql);

    const appliedRows = await this.database.query<AppliedMigrationRow>(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC'
    );
    const appliedByVersion = new Map(appliedRows.map((row) => [row.version, row]));
    const latestKnownVersion = this.migrations.at(-1)?.version ?? 0;
    const latestAppliedVersion = appliedRows.at(-1)?.version ?? 0;

    if (latestAppliedVersion > latestKnownVersion) {
      throw new MigrationError(
        MigrationErrorCode.NewerDatabase,
        `Database schema ${latestAppliedVersion} is newer than application schema ${latestKnownVersion}`
      );
    }

    for (const migration of this.migrations) {
      const applied = appliedByVersion.get(migration.version);
      if (applied) {
        if (applied.checksum !== migration.checksum || applied.name !== migration.name) {
          throw new MigrationError(
            MigrationErrorCode.ChecksumMismatch,
            `Migration ${migration.version} (${migration.name}) differs from the applied migration`
          );
        }
        continue;
      }

      await this.database.transaction(async (transaction) => {
        await transaction.execute(migration.sql);
        await transaction.run(
          'INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
          [migration.version, migration.name, migration.checksum, nowEpochMs]
        );
      });
    }
  }

  private async configureConnection(): Promise<void> {
    if (this.config.foreignKeys) await this.database.execute('PRAGMA foreign_keys = ON;');
    await this.database.execute(`PRAGMA busy_timeout = ${this.config.busyTimeoutMs};`);
    await this.database.execute(`PRAGMA journal_mode = ${this.config.journalMode};`);
  }

  private validatePlan(): void {
    let expectedVersion = 1;
    const checksums = new Set<string>();
    for (const migration of this.migrations) {
      if (migration.version !== expectedVersion) {
        throw new MigrationError(
          MigrationErrorCode.InvalidPlan,
          `Expected migration version ${expectedVersion}, got ${migration.version}`
        );
      }
      if (!migration.name.trim() || !migration.checksum.trim() || !migration.sql.trim()) {
        throw new MigrationError(MigrationErrorCode.InvalidPlan, `Migration ${migration.version} is incomplete`);
      }
      if (checksums.has(migration.checksum)) {
        throw new MigrationError(MigrationErrorCode.InvalidPlan, `Duplicate migration checksum ${migration.checksum}`);
      }
      checksums.add(migration.checksum);
      expectedVersion += 1;
    }
  }
}
