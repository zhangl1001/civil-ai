import type { ExamCycleId } from '@/kernel/public';
import type { TransactionContext } from '../../contracts/UnitOfWork';
import type { IndexedDbTransactionScope } from './IndexedDbUnitOfWork';
import {
  holdsLearningRecords,
  LearningDataPresentError,
  LearningDataStorage,
  type LearningDataRecord,
  type LearningDataSnapshot,
  type TutorDataMaintenance
} from '../../contracts/TutorDataMaintenance';
import {
  assertSnapshotFits,
  foreignRecordsError,
  snapshotRows,
  sourceIdentityConflictError
} from '../../internal/LearningDataSnapshotPolicy';
import {
  citedQuestionSourceIds,
  keyOf,
  learningRecordStores,
  learningRecordsOf,
  text,
  type RowsByStore
} from './IndexedDbLearningRecords';
import {
  TUTOR_INDEXEDDB_VERSION,
  TutorIndexedDb,
  TutorIndexedDbStore,
  type IndexedDbWriteOperation
} from './TutorIndexedDb';

const snapshotGroups = {
  records: new Set<string>(learningRecordStores),
  references: new Set<string>([TutorIndexedDbStore.QuestionSources])
};

export class IndexedDbTutorDataMaintenance implements TutorDataMaintenance {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly scope: IndexedDbTransactionScope
  ) {}

  async clearLearningData(examCycleId: ExamCycleId, context?: TransactionContext): Promise<number> {
    const records = learningRecordsOf(await this.readStores(learningRecordStores), examCycleId);
    const operations: IndexedDbWriteOperation[] = [];
    for (const [store, rows] of records) {
      rows.forEach((row) => {
        const key = keyOf(store, row);
        if (key) operations.push({ type: 'delete', store, key });
      });
    }
    if (context) {
      operations.forEach((operation) => this.scope.stage(context, operation));
    } else {
      await this.database.writeBatch(operations);
    }
    return operations.length;
  }

  async requireNoLearningData(examCycleId: ExamCycleId, context: TransactionContext): Promise<void> {
    if (holdsLearningRecords(learningRecordsOf(await this.readStores(learningRecordStores), examCycleId).values())) {
      throw new LearningDataPresentError();
    }
    // The read above ran in its own transaction. Repeat it inside the commit, ahead of
    // the caller's writes, so a record another writer adds in between still aborts it.
    const rows = new Map<TutorIndexedDbStore, readonly LearningDataRecord[]>();
    learningRecordStores.forEach((store, index) => this.scope.stage(context, {
      type: 'check',
      store,
      check: (values) => {
        rows.set(store, values as readonly LearningDataRecord[]);
        if (index === learningRecordStores.length - 1
          && holdsLearningRecords(learningRecordsOf(rows, examCycleId).values())) {
          throw new LearningDataPresentError();
        }
      }
    }));
  }

  async exportLearningData(examCycleId: ExamCycleId): Promise<LearningDataSnapshot> {
    const rows = await this.readStores([...learningRecordStores, TutorIndexedDbStore.QuestionSources]);
    const records = learningRecordsOf(rows, examCycleId);
    const sourceIds = citedQuestionSourceIds(records);
    return {
      storage: LearningDataStorage.IndexedDb,
      schemaVersion: TUTOR_INDEXEDDB_VERSION,
      records: Object.fromEntries(learningRecordStores.map((store) => [store, records.get(store) ?? []])),
      references: {
        [TutorIndexedDbStore.QuestionSources]: (rows.get(TutorIndexedDbStore.QuestionSources) ?? [])
          .filter((row) => sourceIds.has(text(row.id)))
      }
    };
  }

  async restoreLearningData(
    examCycleId: ExamCycleId,
    snapshot: LearningDataSnapshot,
    context: TransactionContext
  ): Promise<number> {
    assertSnapshotFits(snapshot, LearningDataStorage.IndexedDb, TUTOR_INDEXEDDB_VERSION, snapshotGroups);
    const provided = new Map(learningRecordStores.map((store) => [store, snapshotRows(snapshot.records, store)]));
    // The same selection clearLearningData uses must claim every record, or the file mixes in another cycle.
    const owned = learningRecordsOf(provided, examCycleId);
    for (const store of learningRecordStores) {
      if ((owned.get(store)?.length ?? 0) !== (provided.get(store)?.length ?? 0)) throw foreignRecordsError(store);
    }
    const sources = await this.database.getAll<LearningDataRecord>(TutorIndexedDbStore.QuestionSources);
    const existingSources = new Set(sources.map((row) => text(row.id)));
    // `add` runs after the cleanup's deletes in the same batch; a key another cycle still owns aborts it.
    let restored = 0;
    for (const [store, rows] of provided) {
      rows.forEach((value) => this.scope.stage(context, { type: 'add', store, value }));
      restored += rows.length;
    }
    for (const source of snapshotRows(snapshot.references, TutorIndexedDbStore.QuestionSources)) {
      if (existingSources.has(text(source.id))) continue;
      // Ids are per device: the same source imported again here has another id and the unique hash indexes.
      const twin = sources.find((row) => (
        (text(row.identityHash) && row.identityHash === source.identityHash)
        || (text(row.contentHash) && row.contentHash === source.contentHash)
      ));
      if (twin) throw sourceIdentityConflictError(text(source.paperName) || text(source.provider) || text(source.id));
      this.scope.stage(context, { type: 'add', store: TutorIndexedDbStore.QuestionSources, value: source });
    }
    return restored;
  }

  restoreLegacyRecords<T>(
    _examCycleId: ExamCycleId,
    _context: TransactionContext,
    write: () => Promise<T>
  ): Promise<T> {
    // IndexedDB keeps no foreign keys, so legacy records need no deferred checks.
    return write();
  }

  private async readStores(stores: readonly TutorIndexedDbStore[]): Promise<RowsByStore> {
    const rows = await Promise.all(stores.map((store) => this.database.getAll<LearningDataRecord>(store)));
    return new Map(stores.map((store, index) => [store, rows[index]]));
  }
}
