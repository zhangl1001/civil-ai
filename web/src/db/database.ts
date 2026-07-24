import { DB_NAME, DB_VERSION, STORES, type StoreName } from './schema';
import { Capacitor } from '@capacitor/core';

export type DbScalarKey = string | number;
export type DbKey = DbScalarKey | DbScalarKey[];

export interface DbKeyRange {
  lower?: DbKey;
  upper?: DbKey;
  only?: DbKey;
  lowerOpen?: boolean;
  upperOpen?: boolean;
}

export type DatabaseOperation =
  | { type: 'put'; storeName: StoreName; value: unknown }
  | { type: 'putMany'; storeName: StoreName; values: unknown[] }
  | { type: 'delete'; storeName: StoreName; key: DbKey };

export interface DatabaseAdapter {
  init(): Promise<void>;
  get<T>(storeName: StoreName, key: DbKey): Promise<T | undefined>;
  put<T>(storeName: StoreName, value: T): Promise<void>;
  putMany<T>(storeName: StoreName, values: T[]): Promise<void>;
  delete(storeName: StoreName, key: DbKey): Promise<void>;
  list<T>(storeName: StoreName): Promise<T[]>;
  queryByIndex<T>(storeName: StoreName, indexName: string, key: DbKey | DbKeyRange): Promise<T[]>;
  transaction(operations: DatabaseOperation[]): Promise<void>;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

function getOrCreateStore(db: IDBDatabase, tx: IDBTransaction | null, name: StoreName, options?: IDBObjectStoreParameters): IDBObjectStore {
  if (db.objectStoreNames.contains(name)) {
    if (!tx) throw new Error(`IndexedDB upgrade transaction missing for ${name}`);
    return tx.objectStore(name);
  }
  return db.createObjectStore(name, options);
}

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string | string[], options?: IDBIndexParameters): void {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

function createStores(db: IDBDatabase, tx: IDBTransaction | null): void {
  const projects = getOrCreateStore(db, tx, STORES.projects, { keyPath: 'id' });
  ensureIndex(projects, 'name', 'name', { unique: true });

  const examProfiles = getOrCreateStore(db, tx, STORES.examProfiles, { keyPath: 'id' });
  ensureIndex(examProfiles, 'projectId', 'projectId', { unique: false });
  ensureIndex(examProfiles, 'status', 'status', { unique: false });
  ensureIndex(examProfiles, 'projectStatus', ['projectId', 'status'], { unique: false });

  getOrCreateStore(db, tx, STORES.settings, { keyPath: 'key' });

  const files = getOrCreateStore(db, tx, STORES.files, { keyPath: 'id' });
  ensureIndex(files, 'projectId', 'projectId', { unique: false });
  ensureIndex(files, 'projectPath', ['projectId', 'path'], { unique: true });

  const practiceLectures = getOrCreateStore(db, tx, STORES.practiceLectures, { keyPath: 'id' });
  ensureIndex(practiceLectures, 'projectId', 'projectId', { unique: false });
  ensureIndex(practiceLectures, 'projectModule', ['projectId', 'module'], { unique: false });
  ensureIndex(practiceLectures, 'projectModulePoint', ['projectId', 'module', 'knowledgePoint'], { unique: false });

  const questions = getOrCreateStore(db, tx, STORES.questions, { keyPath: 'id' });
  ensureIndex(questions, 'projectId', 'projectId', { unique: false });
  ensureIndex(questions, 'projectModule', ['projectId', 'module'], { unique: false });
  ensureIndex(questions, 'projectSource', ['projectId', 'sourceFile'], { unique: false });

  const sessions = getOrCreateStore(db, tx, STORES.practiceSessions, { keyPath: 'id' });
  ensureIndex(sessions, 'projectId', 'projectId', { unique: false });
  ensureIndex(sessions, 'projectDate', ['projectId', 'date'], { unique: false });

  const answers = getOrCreateStore(db, tx, STORES.answers, { keyPath: 'id' });
  ensureIndex(answers, 'sessionId', 'sessionId', { unique: false });
  ensureIndex(answers, 'questionId', 'questionId', { unique: false });

  const wrongItems = getOrCreateStore(db, tx, STORES.wrongItems, { keyPath: 'id' });
  ensureIndex(wrongItems, 'projectId', 'projectId', { unique: false });
  ensureIndex(wrongItems, 'questionId', 'questionId', { unique: false });
  ensureIndex(wrongItems, 'status', 'status', { unique: false });

  const profiles = getOrCreateStore(db, tx, STORES.abilityProfiles, { keyPath: 'id' });
  ensureIndex(profiles, 'projectId', 'projectId', { unique: false });
  ensureIndex(profiles, 'projectModule', ['projectId', 'module'], { unique: true });

  const profileStatsSnapshots = getOrCreateStore(db, tx, STORES.profileStatsSnapshots, { keyPath: 'id' });
  ensureIndex(profileStatsSnapshots, 'projectId', 'projectId', { unique: false });
  ensureIndex(profileStatsSnapshots, 'profileId', 'profileId', { unique: false });
  ensureIndex(profileStatsSnapshots, 'projectProfileRange', ['projectId', 'profileId', 'range'], { unique: false });

  const abilityDiagnoses = getOrCreateStore(db, tx, STORES.abilityDiagnoses, { keyPath: 'id' });
  ensureIndex(abilityDiagnoses, 'projectId', 'projectId', { unique: false });
  ensureIndex(abilityDiagnoses, 'profileId', 'profileId', { unique: false });
  ensureIndex(abilityDiagnoses, 'projectProfileGenerated', ['projectId', 'profileId', 'generatedAt'], { unique: false });

  const profileInsights = getOrCreateStore(db, tx, STORES.profileInsights, { keyPath: 'id' });
  ensureIndex(profileInsights, 'projectId', 'projectId', { unique: false });
  ensureIndex(profileInsights, 'profileId', 'profileId', { unique: false });
  ensureIndex(profileInsights, 'diagnosisId', 'diagnosisId', { unique: false });
  ensureIndex(profileInsights, 'projectKind', ['projectId', 'kind'], { unique: false });

  const events = getOrCreateStore(db, tx, STORES.learningEvents, { keyPath: 'id' });
  ensureIndex(events, 'projectId', 'projectId', { unique: false });
  ensureIndex(events, 'projectDate', ['projectId', 'date'], { unique: false });

  const digestItems = getOrCreateStore(db, tx, STORES.digestItems, { keyPath: 'id' });
  ensureIndex(digestItems, 'projectId', 'projectId', { unique: false });
  ensureIndex(digestItems, 'projectDate', ['projectId', 'date'], { unique: false });
  ensureIndex(digestItems, 'projectTypeDate', ['projectId', 'type', 'date'], { unique: false });

  const interviewSessions = getOrCreateStore(db, tx, STORES.interviewSessions, { keyPath: 'id' });
  ensureIndex(interviewSessions, 'projectId', 'projectId', { unique: false });
  ensureIndex(interviewSessions, 'projectDate', ['projectId', 'date'], { unique: false });

  const aiSessions = getOrCreateStore(db, tx, STORES.aiSessions, { keyPath: 'id' });
  ensureIndex(aiSessions, 'projectId', 'projectId', { unique: false });

  const aiMessages = getOrCreateStore(db, tx, STORES.aiMessages, { keyPath: 'id' });
  ensureIndex(aiMessages, 'sessionId', 'sessionId', { unique: false });

  const tasks = getOrCreateStore(db, tx, STORES.aiTasks, { keyPath: 'id' });
  ensureIndex(tasks, 'projectId', 'projectId', { unique: false });
  ensureIndex(tasks, 'status', 'status', { unique: false });
  ensureIndex(tasks, 'lockKey', 'lockKey', { unique: false });

  const logs = getOrCreateStore(db, tx, STORES.taskLogs, { keyPath: 'id' });
  ensureIndex(logs, 'taskId', 'taskId', { unique: false });

}

const STORE_KEY_PATH: Record<StoreName, string> = {
  [STORES.projects]: 'id',
  [STORES.examProfiles]: 'id',
  [STORES.settings]: 'key',
  [STORES.files]: 'id',
  [STORES.practiceLectures]: 'id',
  [STORES.questions]: 'id',
  [STORES.practiceSessions]: 'id',
  [STORES.answers]: 'id',
  [STORES.wrongItems]: 'id',
  [STORES.abilityProfiles]: 'id',
  [STORES.profileStatsSnapshots]: 'id',
  [STORES.abilityDiagnoses]: 'id',
  [STORES.profileInsights]: 'id',
  [STORES.learningEvents]: 'id',
  [STORES.digestItems]: 'id',
  [STORES.interviewSessions]: 'id',
  [STORES.aiSessions]: 'id',
  [STORES.aiMessages]: 'id',
  [STORES.aiTasks]: 'id',
  [STORES.taskLogs]: 'id'
};

const STORE_INDEXES: Partial<Record<StoreName, Record<string, string | string[]>>> = {
  [STORES.projects]: { name: 'name' },
  [STORES.examProfiles]: { projectId: 'projectId', status: 'status', projectStatus: ['projectId', 'status'] },
  [STORES.files]: { projectId: 'projectId', projectPath: ['projectId', 'path'] },
  [STORES.practiceLectures]: { projectId: 'projectId', projectModule: ['projectId', 'module'], projectModulePoint: ['projectId', 'module', 'knowledgePoint'] },
  [STORES.questions]: { projectId: 'projectId', projectModule: ['projectId', 'module'], projectSource: ['projectId', 'sourceFile'] },
  [STORES.practiceSessions]: { projectId: 'projectId', projectDate: ['projectId', 'date'] },
  [STORES.answers]: { sessionId: 'sessionId', questionId: 'questionId' },
  [STORES.wrongItems]: { projectId: 'projectId', questionId: 'questionId', status: 'status' },
  [STORES.abilityProfiles]: { projectId: 'projectId', projectModule: ['projectId', 'module'] },
  [STORES.profileStatsSnapshots]: { projectId: 'projectId', profileId: 'profileId', projectProfileRange: ['projectId', 'profileId', 'range'] },
  [STORES.abilityDiagnoses]: { projectId: 'projectId', profileId: 'profileId', projectProfileGenerated: ['projectId', 'profileId', 'generatedAt'] },
  [STORES.profileInsights]: { projectId: 'projectId', profileId: 'profileId', diagnosisId: 'diagnosisId', projectKind: ['projectId', 'kind'] },
  [STORES.learningEvents]: { projectId: 'projectId', projectDate: ['projectId', 'date'] },
  [STORES.digestItems]: { projectId: 'projectId', projectDate: ['projectId', 'date'], projectTypeDate: ['projectId', 'type', 'date'] },
  [STORES.interviewSessions]: { projectId: 'projectId', projectDate: ['projectId', 'date'] },
  [STORES.aiSessions]: { projectId: 'projectId' },
  [STORES.aiMessages]: { sessionId: 'sessionId' },
  [STORES.aiTasks]: { projectId: 'projectId', status: 'status', lockKey: 'lockKey' },
  [STORES.taskLogs]: { taskId: 'taskId' }
};
const SQLITE_MIGRATION_KEY = 'sqliteMigration:indexeddb:v1';

function sqliteColumn(indexName: string): string {
  return `idx_${indexName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function encodeKey(key: DbKey | undefined): string {
  if (key === undefined) return '';
  return Array.isArray(key) ? JSON.stringify(key) : String(key);
}

function recordKey(storeName: StoreName, value: Record<string, unknown>): string {
  const key = value[STORE_KEY_PATH[storeName]];
  if (key === undefined || key === null) throw new Error(`Missing key for ${storeName}`);
  return encodeKey(key as DbKey);
}

function indexValue(value: Record<string, unknown>, keyPath: string | string[]): string {
  if (Array.isArray(keyPath)) return encodeKey(keyPath.map((key) => value[key] as DbScalarKey));
  return encodeKey(value[keyPath] as DbKey | undefined);
}

function isRange(key: DbKey | DbKeyRange): key is DbKeyRange {
  return typeof key === 'object' && !Array.isArray(key) && ('lower' in key || 'upper' in key || 'only' in key);
}

function toIdbKey(key: DbKey): IDBValidKey {
  return key as IDBValidKey;
}

function toIdbQuery(key: DbKey | DbKeyRange): IDBValidKey | IDBKeyRange {
  if (!isRange(key)) return toIdbKey(key);
  if (key.only !== undefined) return IDBKeyRange.only(toIdbKey(key.only));
  if (key.lower !== undefined && key.upper !== undefined) {
    return IDBKeyRange.bound(toIdbKey(key.lower), toIdbKey(key.upper), Boolean(key.lowerOpen), Boolean(key.upperOpen));
  }
  if (key.lower !== undefined) return IDBKeyRange.lowerBound(toIdbKey(key.lower), Boolean(key.lowerOpen));
  if (key.upper !== undefined) return IDBKeyRange.upperBound(toIdbKey(key.upper), Boolean(key.upperOpen));
  throw new Error('Invalid database range');
}

class IndexedDbAdapter implements DatabaseAdapter {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  init(): Promise<void> {
    if (this.db) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('当前环境不支持 IndexedDB'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => createStores(request.result, request.transaction);
      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
        };
        resolve();
      };
      request.onerror = () => reject(request.error || new Error('IndexedDB 初始化失败'));
      request.onblocked = () => reject(new Error('IndexedDB 升级被其他窗口阻塞'));
    });

    return this.initPromise;
  }

  private async store(name: StoreName, mode: IDBTransactionMode): Promise<{ tx: IDBTransaction; store: IDBObjectStore }> {
    await this.init();
    if (!this.db) throw new Error('IndexedDB 未初始化');
    const tx = this.db.transaction(name, mode);
    return { tx, store: tx.objectStore(name) };
  }

  async get<T>(storeName: StoreName, key: DbKey): Promise<T | undefined> {
    const { store } = await this.store(storeName, 'readonly');
    return requestToPromise<T | undefined>(store.get(toIdbKey(key)));
  }

  async put<T>(storeName: StoreName, value: T): Promise<void> {
    const { tx, store } = await this.store(storeName, 'readwrite');
    store.put(value);
    await transactionDone(tx);
  }

  async putMany<T>(storeName: StoreName, values: T[]): Promise<void> {
    if (!values.length) return;
    const { tx, store } = await this.store(storeName, 'readwrite');
    values.forEach((value) => store.put(value));
    await transactionDone(tx);
  }

  async delete(storeName: StoreName, key: DbKey): Promise<void> {
    const { tx, store } = await this.store(storeName, 'readwrite');
    store.delete(toIdbKey(key));
    await transactionDone(tx);
  }

  async list<T>(storeName: StoreName): Promise<T[]> {
    const { store } = await this.store(storeName, 'readonly');
    return requestToPromise<T[]>(store.getAll());
  }

  async queryByIndex<T>(storeName: StoreName, indexName: string, key: DbKey | DbKeyRange): Promise<T[]> {
    const { store } = await this.store(storeName, 'readonly');
    return requestToPromise<T[]>(store.index(indexName).getAll(toIdbQuery(key)));
  }

  async transaction(operations: DatabaseOperation[]): Promise<void> {
    const active = operations.filter((operation) => operation.type !== 'putMany' || operation.values.length);
    if (!active.length) return;
    await this.init();
    if (!this.db) throw new Error('IndexedDB 未初始化');
    const storeNames = Array.from(new Set(active.map((operation) => operation.storeName)));
    const tx = this.db.transaction(storeNames, 'readwrite');
    active.forEach((operation) => {
      const store = tx.objectStore(operation.storeName);
      if (operation.type === 'put') {
        store.put(operation.value);
      } else if (operation.type === 'putMany') {
        operation.values.forEach((value) => store.put(value));
      } else {
        store.delete(toIdbKey(operation.key));
      }
    });
    await transactionDone(tx);
  }
}

type SQLiteDBConnectionLike = {
  open(): Promise<void>;
  execute(statements: string, transaction?: boolean): Promise<unknown>;
  query(statement: string, values?: unknown[]): Promise<{ values?: Array<Record<string, unknown>> }>;
  run(statement: string, values?: unknown[], transaction?: boolean): Promise<unknown>;
  executeSet(set: Array<{ statement: string; values?: unknown[] }>, transaction?: boolean): Promise<unknown>;
};

class SQLiteDbAdapter implements DatabaseAdapter {
  private db: SQLiteDBConnectionLike | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.open();
    return this.initPromise;
  }

  private async open(): Promise<void> {
    const sqliteModule = await import('@capacitor-community/sqlite');
    const sqlite = new sqliteModule.SQLiteConnection(sqliteModule.CapacitorSQLite);
    const consistency = await sqlite.checkConnectionsConsistency().catch(() => ({ result: false }));
    const existing = consistency.result ? await sqlite.isConnection(DB_NAME, false).catch(() => ({ result: false })) : { result: false };
    const db = existing.result
      ? await sqlite.retrieveConnection(DB_NAME, false)
      : await sqlite.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
    this.db = db as SQLiteDBConnectionLike;
    await this.db.open();
    await this.createTables();
    await this.migrateFromIndexedDb();
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('SQLite 未初始化');
    const statements = Object.values(STORES).map((storeName) => {
      const indexes = STORE_INDEXES[storeName] || {};
      const indexColumns = Object.keys(indexes).map((name) => `${sqliteColumn(name)} TEXT`).join(', ');
      const columns = ['id TEXT PRIMARY KEY NOT NULL', 'json TEXT NOT NULL', indexColumns].filter(Boolean).join(', ');
      const indexSql = Object.keys(indexes).map((name) => `CREATE INDEX IF NOT EXISTS ${storeName}_${sqliteColumn(name)} ON ${storeName}(${sqliteColumn(name)});`).join('\n');
      return `CREATE TABLE IF NOT EXISTS ${storeName} (${columns});\n${indexSql}`;
    }).join('\n');
    await this.db.execute(statements, true);
  }

  private async connection(): Promise<SQLiteDBConnectionLike> {
    await this.init();
    if (!this.db) throw new Error('SQLite 未初始化');
    return this.db;
  }

  private async migrateFromIndexedDb(): Promise<void> {
    const marker = await this.get<{ value?: boolean }>(STORES.settings, SQLITE_MIGRATION_KEY);
    if (marker?.value) return;

    try {
      const indexedDb = new IndexedDbAdapter();
      await indexedDb.init();
      const operations: DatabaseOperation[] = [];
      for (const storeName of Object.values(STORES)) {
        const rows = await indexedDb.list<unknown>(storeName);
        if (rows.length) operations.push({ type: 'putMany', storeName, values: rows });
      }
      operations.push({
        type: 'put',
        storeName: STORES.settings,
        value: { key: SQLITE_MIGRATION_KEY, value: true, updatedAt: Date.now() }
      });
      await this.transaction(operations);
    } catch (error) {
      console.warn('[SQLite migration from IndexedDB]', error);
      await this.put(STORES.settings, { key: SQLITE_MIGRATION_KEY, value: true, updatedAt: Date.now() });
    }
  }

  private rowToValue<T>(row: Record<string, unknown> | undefined): T | undefined {
    if (!row?.json || typeof row.json !== 'string') return undefined;
    return JSON.parse(row.json) as T;
  }

  private putStatement<T>(storeName: StoreName, value: T): { statement: string; values: unknown[] } {
    const object = value as Record<string, unknown>;
    const indexes = STORE_INDEXES[storeName] || {};
    const columns = ['id', 'json', ...Object.keys(indexes).map(sqliteColumn)];
    const placeholders = columns.map(() => '?').join(', ');
    return {
      statement: `INSERT OR REPLACE INTO ${storeName} (${columns.join(', ')}) VALUES (${placeholders})`,
      values: [
        recordKey(storeName, object),
        JSON.stringify(value),
        ...Object.values(indexes).map((keyPath) => indexValue(object, keyPath))
      ]
    };
  }

  async get<T>(storeName: StoreName, key: DbKey): Promise<T | undefined> {
    const db = await this.connection();
    const result = await db.query(`SELECT json FROM ${storeName} WHERE id = ? LIMIT 1`, [encodeKey(key)]);
    return this.rowToValue<T>(result.values?.[0]);
  }

  async put<T>(storeName: StoreName, value: T): Promise<void> {
    const db = await this.connection();
    const statement = this.putStatement(storeName, value);
    await db.run(statement.statement, statement.values, true);
  }

  async putMany<T>(storeName: StoreName, values: T[]): Promise<void> {
    if (!values.length) return;
    const db = await this.connection();
    await db.executeSet(values.map((value) => this.putStatement(storeName, value)), true);
  }

  async delete(storeName: StoreName, key: DbKey): Promise<void> {
    const db = await this.connection();
    await db.run(`DELETE FROM ${storeName} WHERE id = ?`, [encodeKey(key)], true);
  }

  async list<T>(storeName: StoreName): Promise<T[]> {
    const db = await this.connection();
    const result = await db.query(`SELECT json FROM ${storeName}`);
    return (result.values || []).map((row) => this.rowToValue<T>(row)).filter((value): value is T => Boolean(value));
  }

  async queryByIndex<T>(storeName: StoreName, indexName: string, key: DbKey | DbKeyRange): Promise<T[]> {
    const db = await this.connection();
    const column = sqliteColumn(indexName);
    let statement = `SELECT json FROM ${storeName} WHERE ${column} = ?`;
    let values: unknown[] = [encodeKey(key as DbKey)];
    if (isRange(key)) {
      const clauses: string[] = [];
      values = [];
      if (key.only !== undefined) {
        clauses.push(`${column} = ?`);
        values.push(encodeKey(key.only));
      } else {
        if (key.lower !== undefined) {
          clauses.push(`${column} ${key.lowerOpen ? '>' : '>='} ?`);
          values.push(encodeKey(key.lower));
        }
        if (key.upper !== undefined) {
          clauses.push(`${column} ${key.upperOpen ? '<' : '<='} ?`);
          values.push(encodeKey(key.upper));
        }
      }
      statement = `SELECT json FROM ${storeName} WHERE ${clauses.join(' AND ')}`;
    }
    const result = await db.query(statement, values);
    return (result.values || []).map((row) => this.rowToValue<T>(row)).filter((value): value is T => Boolean(value));
  }

  async transaction(operations: DatabaseOperation[]): Promise<void> {
    const db = await this.connection();
    const statements = operations.flatMap((operation) => {
      if (operation.type === 'put') return [this.putStatement(operation.storeName, operation.value)];
      if (operation.type === 'putMany') return operation.values.map((value) => this.putStatement(operation.storeName, value));
      return [{ statement: `DELETE FROM ${operation.storeName} WHERE id = ?`, values: [encodeKey(operation.key)] }];
    });
    if (statements.length) await db.executeSet(statements, true);
  }
}

function createDatabaseAdapter(): DatabaseAdapter {
  if (Capacitor.isNativePlatform()) return new SQLiteDbAdapter();
  return new IndexedDbAdapter();
}

export const database = createDatabaseAdapter();
