import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb, TutorIndexedDbStore } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId } from '@/kernel/public';
import type { LearningProgressRecord, LearningProgressRepository } from '../contracts/LearningProgressRepository';
import type { LearningResourceType } from '../domain/LearningProgressCodes';

export class IndexedDbLearningProgressRepository implements LearningProgressRepository {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly scope: IndexedDbTransactionScope
  ) {}

  async save(progress: LearningProgressRecord, context: TransactionContext): Promise<void> {
    this.scope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.LearningProgress,
      value: progress
    });
  }

  async find(
    examCycleId: ExamCycleId,
    resourceType: LearningResourceType,
    resourceKey: string
  ): Promise<LearningProgressRecord | undefined> {
    const records = await this.database.getAllByIndex<LearningProgressRecord>(
      TutorIndexedDbStore.LearningProgress,
      'by_resource',
      [examCycleId, resourceType, resourceKey]
    );
    return records[0];
  }

  listByCycle(examCycleId: ExamCycleId): Promise<readonly LearningProgressRecord[]> {
    return this.database.getAllByIndex<LearningProgressRecord>(
      TutorIndexedDbStore.LearningProgress,
      'by_cycle',
      examCycleId
    );
  }
}
