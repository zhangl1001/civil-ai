import type { ExamCycleId } from '@/kernel/public';
import type { TransactionContext } from './UnitOfWork';

/** Which local store wrote a snapshot: SQLite table rows (iOS) or IndexedDB records (Web). */
export const LearningDataStorage = {
  Sqlite: 'sqlite',
  IndexedDb: 'indexeddb'
} as const;

export type LearningDataStorage = typeof LearningDataStorage[keyof typeof LearningDataStorage];

export type LearningDataRecord = Readonly<Record<string, unknown>>;

/**
 * Everything clearLearningData removes for one cycle, captured so a restore can
 * write it back unchanged. Rows keep the storage's own shape, so a snapshot can
 * only be restored into the storage kind that exported it.
 */
export interface LearningDataSnapshot {
  readonly storage: LearningDataStorage;
  /** Latest applied migration (SQLite) or object-store version (IndexedDB) the rows were written under. */
  readonly schemaVersion: number;
  /** Rows clearLearningData deletes for the cycle, grouped by table or object store. */
  readonly records: Readonly<Record<string, readonly LearningDataRecord[]>>;
  /** Shared rows the records cite, such as question sources; restored only where missing. */
  readonly references: Readonly<Record<string, readonly LearningDataRecord[]>>;
}

/** A snapshot this runtime cannot write back. The message is shown to the user as is. */
export class LearningDataSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LearningDataSnapshotError';
  }
}

export interface TutorDataMaintenance {
  clearLearningData(examCycleId: ExamCycleId, context?: TransactionContext): Promise<number>;
  /** Captures every record clearLearningData would remove, plus the shared rows those records cite. */
  exportLearningData(examCycleId: ExamCycleId, context?: TransactionContext): Promise<LearningDataSnapshot>;
  /**
   * Writes an exported snapshot back into a cycle that holds no learning data,
   * normally right after clearLearningData in the same maintenance transaction.
   * Rejects a snapshot from another storage kind, a newer schema, or with
   * records that do not belong to the cycle.
   */
  restoreLearningData(
    examCycleId: ExamCycleId,
    snapshot: LearningDataSnapshot,
    context: TransactionContext
  ): Promise<number>;
  /**
   * Runs repository writes for a legacy business backup. Such a backup never
   * carried agent runs, blueprints or corrections, so references to them are
   * released instead of failing the whole restore; required references still fail.
   */
  restoreLegacyRecords<T>(
    examCycleId: ExamCycleId,
    context: TransactionContext,
    write: () => Promise<T>
  ): Promise<T>;
}
