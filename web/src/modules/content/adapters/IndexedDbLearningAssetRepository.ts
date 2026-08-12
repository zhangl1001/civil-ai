import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb, TutorIndexedDbStore } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId, InstantMs } from '@/kernel/public';
import type {
  LearningAssetQuery,
  LearningAssetRecord,
  LearningAssetRepository
} from '../contracts/LearningAssetRepository';
import type { LearningAssetKind } from '../domain/LearningAssetCodes';
import { LearningAssetStatus } from '../domain/LearningAssetCodes';

export class IndexedDbLearningAssetRepository implements LearningAssetRepository {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly scope: IndexedDbTransactionScope
  ) {}

  async save(asset: LearningAssetRecord, context: TransactionContext): Promise<void> {
    this.scope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.LearningAssets,
      value: asset
    });
  }

  async saveDraft(asset: LearningAssetRecord, context: TransactionContext): Promise<void> {
    this.scope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.LearningAssets,
      value: asset
    });
  }

  find(id: string): Promise<LearningAssetRecord | undefined> {
    return this.database.get<LearningAssetRecord>(TutorIndexedDbStore.LearningAssets, id);
  }

  async findLatest(
    examCycleId: ExamCycleId,
    kind: LearningAssetKind,
    businessKey: string
  ): Promise<LearningAssetRecord | undefined> {
    return (await this.database.getAll<LearningAssetRecord>(TutorIndexedDbStore.LearningAssets))
      .filter((item) => (
        item.examCycleId === examCycleId
        && item.kind === kind
        && item.businessKey === businessKey
        && item.status !== LearningAssetStatus.Retired
      ))
      .sort(compareLatest)[0];
  }

  async list(query: LearningAssetQuery): Promise<readonly LearningAssetRecord[]> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500) {
      throw new RangeError('Learning asset query limit must be between 1 and 500');
    }
    const offset = query.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0) throw new RangeError('Learning asset query offset must be a non-negative integer');
    return (await this.database.getAll<LearningAssetRecord>(TutorIndexedDbStore.LearningAssets))
      .filter((item) => item.examCycleId === query.examCycleId)
      .filter((item) => !query.kinds?.length || query.kinds.includes(item.kind))
      .filter((item) => !query.businessKey || item.businessKey === query.businessKey)
      .filter((item) => !query.status || item.status === query.status)
      .sort(compareLatest)
      .slice(offset, offset + query.limit);
  }

  async listAll(examCycleId: ExamCycleId): Promise<readonly LearningAssetRecord[]> {
    return (await this.database.getAll<LearningAssetRecord>(TutorIndexedDbStore.LearningAssets))
      .filter((item) => item.examCycleId === examCycleId)
      .sort(compareLatest);
  }

  async retire(id: string, updatedAt: InstantMs, context: TransactionContext): Promise<void> {
    const current = await this.find(id);
    if (!current || current.status === LearningAssetStatus.Retired) return;
    this.scope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.LearningAssets,
      value: { ...current, status: LearningAssetStatus.Retired, updatedAt }
    });
  }

  async retireBusinessKey(
    examCycleId: ExamCycleId,
    kind: LearningAssetKind,
    businessKey: string,
    updatedAt: InstantMs,
    context: TransactionContext
  ): Promise<void> {
    const items = await this.database.getAll<LearningAssetRecord>(TutorIndexedDbStore.LearningAssets);
    items
      .filter((item) => (
        item.examCycleId === examCycleId
        && item.kind === kind
        && item.businessKey === businessKey
        && item.status !== LearningAssetStatus.Retired
      ))
      .forEach((item) => {
        this.scope.stage(context, {
          type: 'put',
          store: TutorIndexedDbStore.LearningAssets,
          value: { ...item, status: LearningAssetStatus.Retired, updatedAt }
        });
      });
  }
}

function compareLatest(left: LearningAssetRecord, right: LearningAssetRecord): number {
  return right.updatedAt - left.updatedAt || right.version - left.version || right.id.localeCompare(left.id);
}
