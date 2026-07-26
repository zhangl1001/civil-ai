import type { SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import type {
  SqlBatchStatement,
  SqlDatabase,
  SqlParameters,
  SqlRow,
  SqlRunResult,
  SqlTransaction
} from '../../contracts/SqlDatabase';
import type { TutorDatabaseLifecycle } from '../../contracts/TutorDatabaseLifecycle';
import {
  TransactionWorkload,
  type UnitOfWorkOptions
} from '../../contracts/UnitOfWork';
import type { TutorDatabaseConfig } from '../../config/TutorDatabaseConfig';
import { AsyncMutex } from '../../internal/AsyncMutex';

export class TutorDatabaseStalledError extends Error {
  readonly code = 'database.stalled';

  constructor(readonly operation: string) {
    super(`本地数据库操作超时（${operation}），应用将自动恢复`);
    this.name = 'TutorDatabaseStalledError';
  }
}

export class TutorDatabaseTransactionTimeoutError extends Error {
  readonly code = 'database.transaction_timeout';

  constructor(readonly deadlineMs: number) {
    super(`本地数据库事务超过 ${deadlineMs}ms，已取消并回滚`);
    this.name = 'TutorDatabaseTransactionTimeoutError';
  }
}

export class CapacitorSqliteDatabase implements SqlDatabase, TutorDatabaseLifecycle {
  private mutex = new AsyncMutex();
  private sqlite: SQLiteConnection | undefined;
  private connection: SQLiteDBConnection | undefined;
  private openPromise: Promise<void> | undefined;
  private stalledError: TutorDatabaseStalledError | undefined;
  private recoveryPromise: Promise<void> | undefined;
  private generation = 0;

  constructor(private readonly config: TutorDatabaseConfig) {}

  async open(): Promise<void> {
    await this.waitUntilReady();
    await this.ensureOpen();
  }

  async waitUntilReady(): Promise<void> {
    while (this.recoveryPromise) await this.recoveryPromise;
  }

  async healthCheck(): Promise<void> {
    await this.serialized('health_check', async (generation) => {
      await this.ensureOpen();
      this.assertGeneration(generation);
      await this.verifyConnectionHealth(this.requireConnection());
    });
  }

  recoverAfterInterruption(reason: string): Promise<void> {
    if (this.recoveryPromise) return this.recoveryPromise;
    const recovery = Promise.resolve().then(() => this.performRecovery(reason));
    const settled = recovery.finally(() => {
      if (this.recoveryPromise === settled) this.recoveryPromise = undefined;
    });
    this.recoveryPromise = settled;
    return settled;
  }

  private async ensureOpen(): Promise<void> {
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
    await this.waitUntilReady();
    const pendingOpen = this.openPromise;
    if (pendingOpen) await pendingOpen.catch(() => undefined);
    const mutex = this.mutex;
    await mutex.runExclusive(async () => {
      const connection = this.connection;
      this.connection = undefined;
      this.openPromise = undefined;
      if (!connection) return;
      await this.rollbackIfActive(connection);
      await this.recoveryCall(() => connection.close());
      await this.recoveryCall(() => this.sqlite?.closeConnection(this.config.name, false));
    }, this.lockOptions('close'));
  }

  async resetForDevelopment(): Promise<void> {
    await this.waitUntilReady();
    const pendingOpen = this.openPromise;
    if (pendingOpen) await pendingOpen.catch(() => undefined);
    const mutex = this.mutex;
    await mutex.runExclusive(async () => {
      const connection = this.connection;
      this.connection = undefined;
      this.openPromise = undefined;
      if (connection) {
        await this.rollbackIfActive(connection);
        await this.recoveryCall(() => connection.delete());
      }
      await this.recoveryCall(() => this.sqlite?.closeConnection(this.config.name, false));
      this.stalledError = undefined;
    }, this.lockOptions('reset'));
  }

  async execute(sql: string): Promise<void> {
    await this.serialized('execute', async (generation) => {
      await this.ensureOpen();
      this.assertGeneration(generation);
      await this.executeUnlocked(sql);
    });
  }

  async run(sql: string, parameters: SqlParameters = []): Promise<SqlRunResult> {
    return this.serialized('run', async (generation) => {
      await this.ensureOpen();
      this.assertGeneration(generation);
      return this.runUnlocked(sql, parameters);
    });
  }

  async query<Row extends SqlRow>(sql: string, parameters: SqlParameters = []): Promise<readonly Row[]> {
    return this.serialized('query', async (generation) => {
      await this.ensureOpen();
      this.assertGeneration(generation);
      return this.queryUnlocked<Row>(sql, parameters);
    });
  }

  async transaction<T>(
    work: (transaction: SqlTransaction) => Promise<T>,
    options: UnitOfWorkOptions = {}
  ): Promise<T> {
    return this.serialized('transaction', async (generation) => {
      await this.ensureOpen();
      this.assertGeneration(generation);
      const connection = this.requireConnection();
      await this.nativeCall('transaction.begin', connection.beginTransaction());
      let expired = false;
      let deadlineTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
      const deadlineMs = options.workload === TransactionWorkload.Maintenance
        ? this.config.maintenanceTransactionDeadlineMs
        : this.config.transactionDeadlineMs;
      const transaction: SqlTransaction = {
        execute: (sql) => this.executeOn(connection, sql, () => expired, generation),
        run: (sql, parameters = []) => this.runOn(connection, sql, parameters, () => expired, generation),
        runBatch: (statements) => this.runBatchOn(connection, statements, () => expired, generation),
        query: <Row extends SqlRow>(sql: string, parameters: SqlParameters = []) =>
          this.queryOn<Row>(connection, sql, parameters, () => expired, generation)
      };

      try {
        const deadline = new Promise<never>((_, reject) => {
          deadlineTimer = globalThis.setTimeout(() => {
            expired = true;
            reject(new TutorDatabaseTransactionTimeoutError(deadlineMs));
          }, deadlineMs);
        });
        const result = await Promise.race([work(transaction), deadline]);
        this.assertTransactionActive(() => expired, generation);
        await this.nativeCall('transaction.commit', connection.commitTransaction());
        return result;
      } catch (error) {
        expired = true;
        const rolledBack = await this.rollbackTransaction(connection);
        if (error instanceof TutorDatabaseTransactionTimeoutError && !rolledBack) {
          const stalled = new TutorDatabaseStalledError('transaction.deadline_rollback');
          this.markStalled(stalled);
          throw stalled;
        }
        throw error;
      } finally {
        if (deadlineTimer !== undefined) globalThis.clearTimeout(deadlineTimer);
      }
    });
  }

  private async openConnection(): Promise<void> {
    const sqlite = await this.connectionManager();
    await this.ensureEncryptionSecret(sqlite);
    const consistency = await this.nativeCall(
      'connection.consistency',
      sqlite.checkConnectionsConsistency()
    ).catch(() => ({ result: false }));
    const existing = consistency.result
      ? await this.nativeCall('connection.exists', sqlite.isConnection(this.config.name, false))
        .catch(() => ({ result: false }))
      : { result: false };
    const databaseExists = await this.nativeCall('database.exists', sqlite.isDatabase(this.config.name))
      .catch(() => ({ result: false }));
    const databaseEncrypted = databaseExists.result
      ? await this.nativeCall('database.encryption', sqlite.isDatabaseEncrypted(this.config.name))
        .catch(() => ({ result: false }))
      : { result: false };
    const encryptionMode = databaseExists.result && !databaseEncrypted.result ? 'encryption' : 'secret';
    const connection = existing.result
      ? await this.nativeCall('connection.retrieve', sqlite.retrieveConnection(this.config.name, false))
      : await this.nativeCall(
        'connection.create',
        sqlite.createConnection(this.config.name, true, encryptionMode, this.config.version, false)
      );
    const openState = await this.nativeCall('connection.open_state', connection.isDBOpen())
      .catch(() => ({ result: false }));
    if (!openState.result) await this.nativeCall('connection.open', connection.open());
    await this.rollbackIfActive(connection, true);
    this.connection = connection;
  }

  private async performRecovery(reason: string): Promise<void> {
    const previousConnection = this.connection;
    const previousSqlite = this.sqlite;

    this.generation += 1;
    this.stalledError = new TutorDatabaseStalledError(`lifecycle.${reason}`);
    this.connection = undefined;
    this.openPromise = undefined;
    this.mutex = new AsyncMutex();

    if (previousConnection) {
      await this.rollbackIfActive(previousConnection);
      await this.recoveryCall(() => previousConnection.close());
    }
    await this.recoveryCall(() => previousSqlite?.closeConnection(this.config.name, false));
    await this.recoveryCall(() => previousSqlite?.closeAllConnections());
    this.sqlite = undefined;
    this.stalledError = undefined;

    try {
      await this.openConnection();
      const connection = this.requireConnection();
      await this.configureConnection(connection);
      await this.verifyConnectionHealth(connection);
    } catch (error) {
      const stalled = error instanceof TutorDatabaseStalledError
        ? error
        : new TutorDatabaseStalledError(`lifecycle.${reason}.reopen`);
      this.markStalled(stalled);
      throw error;
    }
  }

  private async configureConnection(connection: SQLiteDBConnection): Promise<void> {
    if (this.config.foreignKeys) {
      await this.executeOn(connection, 'PRAGMA foreign_keys = ON;');
    }
    await this.executeOn(connection, `PRAGMA busy_timeout = ${this.config.busyTimeoutMs};`);
    await this.executeOn(connection, `PRAGMA journal_mode = ${this.config.journalMode};`);
  }

  private async verifyConnectionHealth(connection: SQLiteDBConnection): Promise<void> {
    const rows = await this.queryOn<Record<string, string | number | null>>(
      connection,
      'PRAGMA quick_check(1);',
      []
    );
    const result = rows[0] ? Object.values(rows[0])[0] : undefined;
    if (String(result ?? '').toLowerCase() !== 'ok') {
      throw new Error(`Tutor SQLite quick_check failed: ${String(result ?? 'empty result')}`);
    }
  }

  private async ensureEncryptionSecret(sqlite: SQLiteConnection): Promise<void> {
    const stored = await this.nativeCall('encryption.secret_state', sqlite.isSecretStored())
      .catch(() => ({ result: false }));
    if (stored.result) return;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    await this.nativeCall('encryption.set_secret', sqlite.setEncryptionSecret(secret));
  }

  private async connectionManager(): Promise<SQLiteConnection> {
    if (!this.sqlite) {
      const sqliteModule = await import('@capacitor-community/sqlite');
      this.sqlite = new sqliteModule.SQLiteConnection(sqliteModule.CapacitorSQLite);
    }
    return this.sqlite;
  }

  private async executeUnlocked(sql: string): Promise<void> {
    await this.executeOn(this.requireConnection(), sql);
  }

  private async runUnlocked(sql: string, parameters: SqlParameters): Promise<SqlRunResult> {
    return this.runOn(this.requireConnection(), sql, parameters);
  }

  private async executeOn(
    connection: SQLiteDBConnection,
    sql: string,
    expired: () => boolean = () => false,
    generation = this.generation
  ): Promise<void> {
    this.assertTransactionActive(expired, generation);
    await this.nativeCall('sql.execute', connection.execute(sql, false));
  }

  private async runOn(
    connection: SQLiteDBConnection,
    sql: string,
    parameters: SqlParameters,
    expired: () => boolean = () => false,
    generation = this.generation
  ): Promise<SqlRunResult> {
    this.assertTransactionActive(expired, generation);
    const result = await this.nativeCall('sql.run', connection.run(sql, [...parameters], false));
    return {
      changes: result.changes?.changes ?? 0,
      lastInsertId: result.changes?.lastId
    };
  }

  private async runBatchOn(
    connection: SQLiteDBConnection,
    statements: readonly SqlBatchStatement[],
    expired: () => boolean = () => false,
    generation = this.generation
  ): Promise<SqlRunResult> {
    this.assertTransactionActive(expired, generation);
    if (!statements.length) return { changes: 0 };
    const result = await this.nativeCall('sql.batch', connection.executeSet(
      statements.map((statement) => ({
        statement: statement.sql,
        values: [...(statement.parameters ?? [])]
      })),
      false
    ));
    return {
      changes: result.changes?.changes ?? 0,
      lastInsertId: result.changes?.lastId
    };
  }

  private async queryUnlocked<Row extends SqlRow>(
    sql: string,
    parameters: SqlParameters
  ): Promise<readonly Row[]> {
    return this.queryOn<Row>(this.requireConnection(), sql, parameters);
  }

  private async queryOn<Row extends SqlRow>(
    connection: SQLiteDBConnection,
    sql: string,
    parameters: SqlParameters,
    expired: () => boolean = () => false,
    generation = this.generation
  ): Promise<readonly Row[]> {
    this.assertTransactionActive(expired, generation);
    const result = await this.nativeCall('sql.query', connection.query(sql, [...parameters]));
    return (result.values ?? []) as Row[];
  }

  private requireConnection(): SQLiteDBConnection {
    if (!this.connection) throw new Error('Tutor SQLite database is not open');
    return this.connection;
  }

  private async serialized<T>(operation: string, work: (generation: number) => Promise<T>): Promise<T> {
    await this.waitUntilReady();
    this.assertHealthy();
    const generation = this.generation;
    const mutex = this.mutex;
    return mutex.runExclusive(async () => {
      this.assertGeneration(generation);
      this.assertHealthy();
      const result = await work(generation);
      this.assertGeneration(generation);
      return result;
    }, this.lockOptions(operation)).catch((error: unknown) => {
      if (
        error instanceof TutorDatabaseStalledError
        && error.operation !== 'connection.replaced'
        && generation === this.generation
      ) {
        this.markStalled(error);
      }
      throw error;
    });
  }

  private lockOptions(operation: string) {
    return {
      waitTimeoutMs: this.config.lockWaitTimeoutMs,
      timeoutError: () => new TutorDatabaseStalledError(`${operation}.lock_wait`)
    };
  }

  private async nativeCall<T>(operation: string, promise: Promise<T>): Promise<T> {
    this.assertHealthy();
    const generation = this.generation;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = globalThis.setTimeout(() => {
        const error = new TutorDatabaseStalledError(operation);
        if (generation === this.generation) this.markStalled(error);
        reject(error);
      }, this.config.nativeOperationTimeoutMs);
    });
    try {
      const result = await Promise.race([promise, timeout]);
      this.assertGeneration(generation);
      return result;
    } finally {
      if (timer !== undefined) globalThis.clearTimeout(timer);
    }
  }

  private async recoveryCall<T>(work: () => Promise<T> | undefined): Promise<T | undefined> {
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve(work()),
        new Promise<undefined>((resolve) => {
          timer = globalThis.setTimeout(() => resolve(undefined), this.config.recoveryOperationTimeoutMs);
        })
      ]);
    } catch {
      return undefined;
    } finally {
      if (timer !== undefined) globalThis.clearTimeout(timer);
    }
  }

  private async rollbackIfActive(connection: SQLiteDBConnection, strict = false): Promise<void> {
    if (strict) {
      const active = await this.nativeCall('transaction.recovery_state', connection.isTransactionActive());
      if (active.result) {
        await this.nativeCall('transaction.recovery_rollback', connection.rollbackTransaction());
      }
      return;
    }
    const active = await this.recoveryCall(() => connection.isTransactionActive());
    if (active?.result) await this.recoveryCall(() => connection.rollbackTransaction());
  }

  private async rollbackTransaction(connection: SQLiteDBConnection): Promise<boolean> {
    const active = await this.recoveryCall(() => connection.isTransactionActive());
    if (active?.result === false) return true;
    const rolledBack = await this.recoveryCall(async () => {
      await connection.rollbackTransaction();
      return true;
    });
    return rolledBack === true;
  }

  private assertTransactionActive(expired: () => boolean, generation = this.generation): void {
    if (expired()) throw new TutorDatabaseStalledError('transaction.expired');
    this.assertGeneration(generation);
    this.assertHealthy();
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.generation) {
      throw new TutorDatabaseStalledError('connection.replaced');
    }
  }

  private assertHealthy(): void {
    if (this.stalledError) throw this.stalledError;
  }

  private markStalled(error: TutorDatabaseStalledError): void {
    if (this.stalledError) return;
    this.stalledError = error;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('zhangl-database-stalled', {
        detail: { code: error.code, operation: error.operation, at: Date.now() }
      }));
    }
  }
}
