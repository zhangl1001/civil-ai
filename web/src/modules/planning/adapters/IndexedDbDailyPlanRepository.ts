import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb, TutorIndexedDbStore } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId, LocalDate } from '@/kernel/public';
import type {
  DailyPlanAggregate,
  DailyPlanBlockRecord,
  DailyPlanItemRecord,
  DailyPlanItemStatusPatch,
  DailyPlanRecord,
  DailyPlanRepository
} from '../contracts/DailyPlanRepository';

export class IndexedDbDailyPlanRepository implements DailyPlanRepository {
  constructor(private readonly db: TutorIndexedDb, private readonly scope: IndexedDbTransactionScope) {}

  async findCurrent(cycle: ExamCycleId, date: LocalDate): Promise<DailyPlanAggregate | undefined> {
    const all = await this.db.getAll<DailyPlanAggregate>(TutorIndexedDbStore.DailyPlanAggregates);
    return all.map(normalizeAggregate).filter((value) => value.plan.examCycleId === cycle && value.plan.planDate === date && value.plan.status === 'active')
      .sort((left, right) => right.plan.version - left.plan.version)[0];
  }

  async listAll(cycle: ExamCycleId): Promise<readonly DailyPlanAggregate[]> {
    const all = await this.db.getAll<DailyPlanAggregate>(TutorIndexedDbStore.DailyPlanAggregates);
    return all.map(normalizeAggregate)
      .filter((value) => value.plan.examCycleId === cycle)
      .sort((left, right) => right.plan.createdAt - left.plan.createdAt || right.plan.version - left.plan.version);
  }

  async replaceCurrent(next: DailyPlanAggregate, previous: DailyPlanRecord | undefined, context: TransactionContext): Promise<void> {
    if (previous) {
      const current = await this.require(previous.id);
      this.scope.stage(context, { type:'put', store:TutorIndexedDbStore.DailyPlanAggregates, value:{ ...current, plan:{ ...current.plan, status:'superseded' } } });
    }
    this.scope.stage(context, { type:'add', store:TutorIndexedDbStore.DailyPlanAggregates, value:next });
  }

  async updateItemById(dailyPlanItemId: string, patch: DailyPlanItemStatusPatch, context: TransactionContext): Promise<DailyPlanItemRecord | undefined> {
    return this.updateMatchingItem((item) => item.id === dailyPlanItemId, patch, context);
  }

  async updateItemByReviewQueueId(reviewQueueItemId: string, patch: DailyPlanItemStatusPatch, context: TransactionContext): Promise<DailyPlanItemRecord | undefined> {
    return this.updateMatchingItem((item) => item.reviewQueueItemId === reviewQueueItemId, patch, context);
  }

  private async updateMatchingItem(
    matches: (item: DailyPlanItemRecord) => boolean,
    patch: DailyPlanItemStatusPatch,
    context: TransactionContext
  ): Promise<DailyPlanItemRecord | undefined> {
    const all = await this.db.getAll<DailyPlanAggregate>(TutorIndexedDbStore.DailyPlanAggregates);
    const aggregate = all.map(normalizeAggregate).filter((value) => value.plan.status === 'active' && value.items.some(matches))
      .sort((left, right) => right.plan.version - left.plan.version)[0];
    if (!aggregate) return undefined;
    let updated: DailyPlanItemRecord | undefined;
    const items = aggregate.items.map((item) => {
      if (!matches(item)) return item;
      updated = {
        ...item,
        status: patch.status,
        actualMinutes: patch.actualMinutes ?? item.actualMinutes,
        resultSummary: patch.resultSummary ?? item.resultSummary,
        failureCode: patch.failureCode,
        failureMessage: patch.failureMessage,
        finishedAt: patch.finishedAt
      };
      return updated;
    });
    if (!updated) return undefined;
    this.scope.stage(context, { type:'put', store:TutorIndexedDbStore.DailyPlanAggregates, value:{ ...aggregate, items } });
    return updated;
  }

  private async require(id: string): Promise<DailyPlanAggregate> {
    const item = await this.db.get<DailyPlanAggregate>(TutorIndexedDbStore.DailyPlanAggregates, id);
    if (!item) throw new Error(`Daily plan version conflict: ${id}`);
    return normalizeAggregate(item);
  }
}

function normalizeAggregate(value: DailyPlanAggregate): DailyPlanAggregate {
  const rawBlocks = Array.isArray(value.blocks) ? value.blocks : [];
  const blockByCapability = new Map(rawBlocks.map((block) => [block.capabilityNodeId, block]));
  const blocks: DailyPlanBlockRecord[] = [...rawBlocks];
  const items = value.items.map((item) => {
    let block = blockByCapability.get(item.capabilityNodeId);
    if (!block) {
      block = {
        id:`DailyPlanBlockId:legacy:${value.plan.id}:${blocks.length + 1}`,
        dailyPlanId:value.plan.id,
        capabilityNodeId:item.capabilityNodeId,
        subject:item.itemType === 'essay' ? 'essay' : 'aptitude',
        module:'',
        teachingGoalCode:'legacy_plan_item',
        sequence:blocks.length + 1,
        priority:50,
        required:true
      };
      blocks.push(block);
      blockByCapability.set(item.capabilityNodeId, block);
    }
    return {
      ...item,
      dailyPlanBlockId:item.dailyPlanBlockId || block.id,
      category:item.category || categoryFor(item.itemType),
      priority:Number.isFinite(item.priority) ? item.priority : 50,
      required:item.required ?? true,
      dependencyIds:Array.isArray(item.dependencyIds) ? item.dependencyIds : []
    };
  });
  return { ...value, blocks, items };
}

function categoryFor(itemType: DailyPlanItemRecord['itemType']): DailyPlanItemRecord['category'] {
  if (itemType === 'lecture') return 'learn';
  if (itemType === 'review') return 'review';
  if (itemType === 'diagnosis' || itemType === 'mock') return 'assess';
  if (itemType === 'digest') return 'accumulate';
  return 'practice';
}
