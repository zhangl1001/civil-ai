// Test doubles for the two tutor storage engines. They run the real
// repositories and maintenance adapters, so checks can compare whole databases
// instead of asserting on recorded SQL.
import { DatabaseSync } from 'node:sqlite';

/**
 * Models @capacitor-community/sqlite execute() on iOS: every line is trimmed,
 * and SQL containing DELETE FROM loses all newlines and whatever follows its
 * last semicolon.
 */
export function nativeExecuteSql(sql) {
  const trimmedLines = sql.split('\n').map((line) => line.trim()).join('\n');
  if (!/DELETE FROM/i.test(trimmedLines)) return trimmedLines;
  const statements = trimmedLines.replace(/\n/g, '').split(';');
  statements.pop();
  return statements.join(';');
}

/**
 * SqlDatabase over node:sqlite. Like the iOS plugin, numbers bind as REAL and
 * execute() goes through the native rewrite; transactions are serialized.
 */
export function createNodeSqliteDatabase() {
  const raw = new DatabaseSync(':memory:');
  let tail = Promise.resolve();
  const statements = {
    async execute(sql) {
      raw.exec(nativeExecuteSql(sql));
    },
    async run(sql, parameters = []) {
      const result = raw.prepare(sql).run(...parameters);
      return { changes: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
    },
    async runBatch(batch) {
      let changes = 0;
      for (const statement of batch) {
        changes += Number(raw.prepare(statement.sql).run(...(statement.parameters ?? [])).changes);
      }
      return { changes };
    },
    async query(sql, parameters = []) {
      return raw.prepare(sql).all(...parameters).map((row) => ({ ...row }));
    }
  };
  return {
    raw,
    ...statements,
    async open() {},
    async close() {
      raw.close();
    },
    transaction(work) {
      const run = tail.then(async () => {
        raw.exec('BEGIN');
        try {
          const result = await work(statements);
          raw.exec('COMMIT');
          return result;
        } catch (error) {
          if (raw.isTransaction) raw.exec('ROLLBACK');
          throw error;
        }
      });
      tail = run.catch(() => undefined);
      return run;
    }
  };
}

/** Every row of every table, keyed by table and ordered by rowid, for whole-database comparisons. */
export function dumpSqliteTables(raw) {
  const tables = raw.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map((row) => row.name);
  return Object.fromEntries(tables.map((table) => [
    table,
    raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((row) => ({ ...row }))
  ]));
}

/** Object-store key paths as TutorIndexedDb declares them, read from its source so the double cannot drift. */
export function indexedDbKeyPaths(source, storeNames) {
  const keyPaths = new Map();
  const pattern = /createObjectStore\(\s*TutorIndexedDbStore\.(\w+),\s*\{\s*keyPath:\s*(?:'([^']*)'|\[([^\]]*)\])/g;
  for (const match of source.matchAll(pattern)) {
    const keyPath = match[2] ?? match[3].split(',').map((part) => part.trim().replace(/^'|'$/g, ''));
    keyPaths.set(storeNames[match[1]], keyPath);
  }
  return keyPaths;
}

/**
 * TutorIndexedDb in memory. writeBatch is atomic and applies operations in
 * order; `add` rejects an existing key like IndexedDB's ConstraintError.
 */
export function createMemoryTutorIndexedDb(keyPaths) {
  let stores = new Map();
  const table = (map, store) => {
    if (!keyPaths.has(store)) throw new Error(`Unknown IndexedDB store ${store}`);
    if (!map.has(store)) map.set(store, new Map());
    return map.get(store);
  };
  const keyOf = (store, value) => {
    const keyPath = keyPaths.get(store);
    const key = Array.isArray(keyPath) ? keyPath.map((path) => valueAt(value, path)) : valueAt(value, keyPath);
    if (key === undefined || (Array.isArray(key) && key.some((part) => part === undefined))) {
      throw new Error(`DataError: ${store} record has no key`);
    }
    return JSON.stringify(key);
  };
  const apply = (target, operations) => {
    for (const operation of operations) {
      const records = table(target, operation.store);
      if (operation.type === 'delete') {
        records.delete(JSON.stringify(operation.key));
        continue;
      }
      const key = keyOf(operation.store, operation.value);
      if (operation.type === 'add' && records.has(key)) {
        throw new Error(`ConstraintError: ${operation.store} already holds ${key}`);
      }
      records.set(key, structuredClone(operation.value));
    }
  };
  const database = {
    async open() {},
    close() {},
    async get(store, key) {
      const value = table(stores, store).get(JSON.stringify(key));
      return value === undefined ? undefined : structuredClone(value);
    },
    async getAll(store) {
      return [...table(stores, store).entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([, value]) => structuredClone(value));
    },
    async getAllByIndex(store, indexName) {
      throw new Error(`Memory IndexedDB has no index ${store}.${indexName}; add it to the test double`);
    },
    async writeBatch(operations) {
      const next = new Map([...stores].map(([store, records]) => [store, new Map(records)]));
      apply(next, operations);
      stores = next;
    },
    async mutateStore(store, mutation) {
      const outcome = mutation(await database.getAll(store));
      if (outcome.operations.some((operation) => operation.store !== store)) {
        throw new Error('IndexedDB mutation cannot write another store');
      }
      await database.writeBatch(outcome.operations);
      return outcome.result;
    },
    async mutateStores(storeNames, mutation) {
      const values = new Map();
      for (const store of storeNames) values.set(store, await database.getAll(store));
      const outcome = mutation(values);
      await database.writeBatch(outcome.operations);
      return outcome.result;
    },
    /** Every store's records, ordered by key, as plain JSON for comparisons. */
    dump() {
      return Object.fromEntries([...stores.keys()].sort().map((store) => [
        store,
        [...stores.get(store).entries()]
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([, value]) => JSON.parse(JSON.stringify(value)))
      ]).filter(([, records]) => records.length > 0));
    }
  };
  return database;
}

/** A ConversationStore stand-in whose replace can be made to fail once. */
export function createMemoryConversationStore(sessions = [], messages = []) {
  const state = { sessions: [...sessions], messages: [...messages], failNextReplace: false };
  return {
    state,
    async listSessions(projectId) {
      return state.sessions.filter((session) => session.projectId === projectId);
    },
    async listMessages(sessionId) {
      return state.messages.filter((message) => message.sessionId === sessionId);
    },
    async replaceProjectConversations(projectId, nextSessions, nextMessages) {
      if (state.failNextReplace) {
        state.failNextReplace = false;
        throw new Error('conversation log unavailable');
      }
      state.sessions = [...state.sessions.filter((session) => session.projectId !== projectId), ...nextSessions];
      state.messages = [...nextMessages];
      return nextSessions.length + nextMessages.length;
    }
  };
}

function valueAt(value, path) {
  return path.split('.').reduce((current, part) => (current === undefined || current === null ? undefined : current[part]), value);
}
