import type { SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import type {
  SqlDatabase,
  SqlParameters,
  SqlRow,
  SqlRunResult,
  SqlTransaction
} from '../../contracts/SqlDatabase';
import type { TutorDatabaseConfig } from '../../config/TutorDatabaseConfig';
import { AsyncMutex } from '../../internal/AsyncMutex';

export class CapacitorSqliteDatabase implements SqlDatabase {
  private readonly mutex = new AsyncMutex();
  private sqlite: SQLiteConnection | undefined;
  private connection: SQLiteDBConnection | undefined;
  private openPromise: Promise<void> | undefined;

  constructor(private readonly config: TutorDatabaseConfig) {}

  async open(): Promise<void> {
    if (this.connection) return;
    if (!this.openPromise) {
      this.openPromise = this.openConnection().catch((error: unknown) => {
        this.openPromise = undefined;
        throw error;
      });
    }
    await this.openPromise;
  }

  async close(): Promise<void> {
    const pendingOpen = this.openPromise;
    if (pendingOpen) await pendingOpen.catch(() => undefined);
    await this.mutex.runExclusive(async () => {
      const connection = this.connection;
      this.connection = undefined;
      this.openPromise = undefined;
      if (!connection) return;
      const active = await connection.isTransactionActive();
      if (active.result) await connection.rollbackTransaction();
      await connection.close();
      await this.sqlite?.closeConnection(this.config.name, false).catch(() => undefined);
    });
  }

  async resetForDevelopment(): Promise<void> {
    const pendingOpen = this.openPromise;
    if (pendingOpen) await pendingOpen.catch(() => undefined);
    await this.mutex.runExclusive(async () => {
      const connection = this.connection;
      this.connection = undefined;
      this.openPromise = undefined;
      if (connection) {
        const active = await connection.isTransactionActive().catch(() => ({ result: false }));
        if (active.result) await connection.rollbackTransaction().catch(() => undefined);
        await connection.delete();
      }
      await this.sqlite?.closeConnection(this.config.name, false).catch(() => undefined);
    });
  }

  async execute(sql: string): Promise<void> {
    await this.mutex.runExclusive(async () => {
      await this.open();
      await this.executeUnlocked(sql);
    });
  }

  async run(sql: string, parameters: SqlParameters = []): Promise<SqlRunResult> {
    return this.mutex.runExclusive(async () => {
      await this.open();
      return this.runUnlocked(sql, parameters);
    });
  }

  async query<Row extends SqlRow>(sql: string, parameters: SqlParameters = []): Promise<readonly Row[]> {
    return this.mutex.runExclusive(async () => {
      await this.open();
      return this.queryUnlocked<Row>(sql, parameters);
    });
  }

  async transaction<T>(work: (transaction: SqlTransaction) => Promise<T>): Promise<T> {
    return this.mutex.runExclusive(async () => {
      await this.open();
      const connection = this.requireConnection();
      await connection.beginTransaction();
      const transaction: SqlTransaction = {
        execute: (sql) => this.executeUnlocked(sql),
        run: (sql, parameters = []) => this.runUnlocked(sql, parameters),
        query: <Row extends SqlRow>(sql: string, parameters: SqlParameters = []) =>
          this.queryUnlocked<Row>(sql, parameters)
      };

      try {
        const result = await work(transaction);
        await connection.commitTransaction();
        return result;
      } catch (error) {
        await connection.rollbackTransaction().catch(() => undefined);
        throw error;
      }
    });
  }

  private async openConnection(): Promise<void> {
    const sqlite = await this.connectionManager();
    const consistency = await sqlite.checkConnectionsConsistency().catch(() => ({ result: false }));
    const existing = consistency.result
      ? await sqlite.isConnection(this.config.name, false).catch(() => ({ result: false }))
      : { result: false };
    const connection = existing.result
      ? await sqlite.retrieveConnection(this.config.name, false)
      : await sqlite.createConnection(this.config.name, false, 'no-encryption', this.config.version, false);
    const openState = await connection.isDBOpen().catch(() => ({ result: false }));
    if (!openState.result) await connection.open();
    this.connection = connection;
  }

  private async connectionManager(): Promise<SQLiteConnection> {
    if (!this.sqlite) {
      const sqliteModule = await import('@capacitor-community/sqlite');
      this.sqlite = new sqliteModule.SQLiteConnection(sqliteModule.CapacitorSQLite);
    }
    return this.sqlite;
  }

  private async executeUnlocked(sql: string): Promise<void> {
    await this.requireConnection().execute(sql, false);
  }

  private async runUnlocked(sql: string, parameters: SqlParameters): Promise<SqlRunResult> {
    const result = await this.requireConnection().run(sql, [...parameters], false);
    return {
      changes: result.changes?.changes ?? 0,
      lastInsertId: result.changes?.lastId
    };
  }

  private async queryUnlocked<Row extends SqlRow>(
    sql: string,
    parameters: SqlParameters
  ): Promise<readonly Row[]> {
    const result = await this.requireConnection().query(sql, [...parameters]);
    return (result.values ?? []) as Row[];
  }

  private requireConnection(): SQLiteDBConnection {
    if (!this.connection) throw new Error('Tutor SQLite database is not open');
    return this.connection;
  }
}
