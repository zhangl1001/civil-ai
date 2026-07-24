import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb, TutorIndexedDbStore } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId, LocalDate } from '@/kernel/public';
import type {
  DailyPlanAggregate,
  DailyPlanItemRecord,
  DailyPlanItemStatusPatch,
  DailyPlanRecord,
  DailyPlanRepository
} from '../contracts/DailyPlanRepository';

export class IndexedDbDailyPlanRepository implements DailyPlanRepository {
  constructor(private readonly db: TutorIndexedDb, private readonly scope: IndexedDbTransactionScope) {}

  async findCurrent(cycle: ExamCycleId, date: LocalDate): Promise<DailyPlanAggregate | undefined> {
    const all = await this.db.getAll<DailyPlanAggregate>(TutorIndexedDbStore.DailyPlanAggregates);
    return all.filter((value) => value.plan.examCycleId === cycle && value.plan.planDate === date && value.plan.status === 'active')
      .sort((left, right) => right.plan.version - left.plan.version)[0];
  }

  async replaceCurrent(next: DailyPlanAggregate, previous: DailyPlanRecord | undefined, context: TransactionContext): Promise<void> {
    if (previous) {
      const current = await this.require(previous.id);
      this.scope.stage(context, { type:'put', store:TutorIndexedDbStore.DailyPlanAggregates, value:{ ...current, plan:{ ...current.plan, status:'superseded' } } });
    }
    this.scope.stage(context, { type:'add', store:TutorIndexedDbStore.DailyPlanAggregates, value:next });
  }

  async updateItemByReviewQueueId(reviewQueueItemId: string, patch: DailyPlanItemStatusPatch, context: TransactionContext): Promise<DailyPlanItemRecord | undefined> {
    const all = await this.db.getAll<DailyPlanAggregate>(TutorIndexedDbStore.DailyPlanAggregates);
    const aggregate = all.filter((value) => value.plan.status === 'active' && value.items.some((item) => item.reviewQueueItemId === reviewQueueItemId))
      .sort((left, right) => right.plan.version - left.plan.version)[0];
    if (!aggregate) return undefined;
    let updated: DailyPlanItemRecord | undefined;
    const items = aggregate.items.map((item) => {
      if (item.reviewQueueItemId !== reviewQueueItemId) return item;
      updated = { ...item, status: patch.status, actualMinutes: patch.actualMinutes ?? item.actualMinutes };
      return updated;
    });
    if (!updated) return undefined;
    this.scope.stage(context, { type:'put', store:TutorIndexedDbStore.DailyPlanAggregates, value:{ ...aggregate, items } });
    return updated;
  }

  private async require(id: string): Promise<DailyPlanAggregate> {
    const item = await this.db.get<DailyPlanAggregate>(TutorIndexedDbStore.DailyPlanAggregates, id);
    if (!item) throw new Error(`Daily plan version conflict: ${id}`);
    return item;
  }
}
