import type { IndexedDbWriteOperation } from './IndexedDbOperations';

/** Reads used to validate a staged mutation and its write share one native transaction. */
export function writeIndexedDbBatch(database: IDBDatabase, operations: readonly IndexedDbWriteOperation[]): Promise<void> {
  if (!operations.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([...new Set(operations.map((item) => item.store))], 'readwrite');
    let failure: unknown;
    const abort = (error: unknown) => {
      failure = error;
      transaction.abort();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => { failure ??= transaction.error; };
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Tutor IndexedDB transaction aborted'));
    enqueueIndexedDbOperations(transaction, operations, abort);
  });
}

/** Queue in order so later guards observe earlier writes in this transaction. */
export function enqueueIndexedDbOperations(
  transaction: IDBTransaction, operations: readonly IndexedDbWriteOperation[], abort: (error: unknown) => void
): void {
  let index = 0;
  const next = (): void => {
    const operation = operations[index++];
    if (!operation) return;
    try {
      const store = transaction.objectStore(operation.store);
      if (operation.type === 'update' || operation.type === 'check') {
        const read = operation.type === 'check' ? store.getAll() : store.get(operation.key!);
        read.onsuccess = () => {
          try {
            if (operation.type === 'check') {
              operation.check!(read.result as readonly unknown[]);
              next();
            } else {
              const write = store.put(operation.update!(read.result));
              write.onsuccess = next;
            }
          } catch (error) { abort(error); }
        };
        return;
      }
      const request = operation.type === 'add' ? store.add(operation.value)
        : operation.type === 'put' ? store.put(operation.value)
          : store.delete(operation.key!);
      request.onsuccess = next;
    } catch (error) { abort(error); }
  };
  next();
}
