import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, IdGenerator, JsonObject, LocalDate } from '@/kernel/public';
import type {
  DailyPlanAggregate,
  DailyPlanBlockRecord,
  DailyPlanItemRecord,
  DailyPlanRepository
} from '../contracts/DailyPlanRepository';
import { DailyPlanItemStatus, DailyPlanStatus } from '../domain/DailyPlanCodes';
import type { DailyPlanProposal } from '../domain/DailyPlanPolicy';

export class PersistDailyPlanProposal {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: DailyPlanRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: {
    readonly proposal: DailyPlanProposal;
    readonly planDate: LocalDate;
    readonly phase: string;
    readonly retainTerminalItems?: boolean;
    readonly availableMinutes?: number;
    readonly decisionFactors?: JsonObject;
  }): Promise<DailyPlanAggregate> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(command.planDate) || !command.phase.trim()) {
      throw new Error('Daily plan date and phase are required');
    }
    const previous = await this.repository.findCurrent(command.proposal.examCycleId, command.planDate);
    const now = this.clock.now();
    const planId = this.ids.next('DailyPlanId');
    const retained = command.retainTerminalItems && previous
      ? retainTerminalPlan(previous, planId, this.ids)
      : { blocks: [], items: [] };
    const proposed = materializeProposal(command.proposal, planId, retained.items.length, retained.blocks.length, this.ids);
    const aggregate: DailyPlanAggregate = {
      plan: {
        id: planId,
        examCycleId: command.proposal.examCycleId,
        planDate: command.planDate,
        version: (previous?.plan.version ?? 0) + 1,
        status: DailyPlanStatus.Active,
        phase: command.phase.trim(),
        availableMinutes: command.availableMinutes ?? command.proposal.availableMinutes,
        decisionSummary: '今日计划已按最新能力证据更新。',
        decisionFactors: {
          plannedMinutes: command.proposal.plannedMinutes,
          rationaleCodes: [...command.proposal.rationaleCodes],
          strategy: command.proposal.strategy,
          learningLoad: command.proposal.learningLoad,
          ...(command.decisionFactors ?? {})
        } as unknown as JsonObject,
        createdBy: 'system',
        createdAt: now,
        supersedesPlanId: previous?.plan.id
      },
      blocks: [...retained.blocks, ...proposed.blocks],
      items: [...retained.items, ...proposed.items]
    };
    await this.unitOfWork.run((context) => this.repository.replaceCurrent(aggregate, previous?.plan, context));
    return aggregate;
  }
}

function materializeProposal(
  proposal: DailyPlanProposal,
  planId: string,
  itemOffset: number,
  blockOffset: number,
  ids: IdGenerator
): Pick<DailyPlanAggregate, 'blocks' | 'items'> {
  const blockIds = new Map(proposal.blocks.map((block) => [block.key, ids.next('DailyPlanBlockId')]));
  const itemIds = new Map(proposal.items.map((item) => [item.key, ids.next('DailyPlanItemId')]));
  const blocks = proposal.blocks.map((block, index): DailyPlanBlockRecord => ({
    id: blockIds.get(block.key)!,
    dailyPlanId: planId,
    capabilityNodeId: block.capabilityNodeId,
    subject: block.subject,
    module: block.module,
    teachingGoalCode: block.teachingGoalCode,
    sequence: blockOffset + index + 1,
    priority: block.priority,
    required: block.required
  }));
  const items = proposal.items.map((item, index): DailyPlanItemRecord => ({
    id: itemIds.get(item.key)!,
    dailyPlanId: planId,
    dailyPlanBlockId: blockIds.get(item.blockKey)!,
    capabilityNodeId: item.capabilityNodeId,
    ...(item.reviewQueueItemId ? { reviewQueueItemId: item.reviewQueueItemId } : {}),
    category: item.category,
    itemType: item.action,
    sequence: itemOffset + index + 1,
    targetMinutes: item.targetMinutes,
    ...(item.targetCount === undefined ? {} : { targetCount: item.targetCount }),
    priority: item.priority,
    required: item.required,
    dependencyIds: item.dependencyKeys.flatMap((key) => {
      const dependencyId = itemIds.get(key);
      return dependencyId ? [dependencyId] : [];
    }),
    exitCriteria: item.completionCriteria as JsonObject,
    reason: item.reasonCode,
    status: DailyPlanItemStatus.Pending,
    actualMinutes: 0
  }));
  return { blocks, items };
}

function retainTerminalPlan(
  previous: DailyPlanAggregate,
  planId: string,
  ids: IdGenerator
): Pick<DailyPlanAggregate, 'blocks' | 'items'> {
  const normalizedItems = previous.items.map((item, index): DailyPlanItemRecord => ({
    ...item,
    dailyPlanBlockId:item.dailyPlanBlockId || `DailyPlanBlockId:legacy:${previous.plan.id}:${index + 1}`,
    category:item.category || legacyCategory(item.itemType),
    priority:Number.isFinite(item.priority) ? item.priority : 50,
    required:item.required ?? true,
    dependencyIds:Array.isArray(item.dependencyIds) ? item.dependencyIds : []
  }));
  const sourceBlocks = previous.blocks?.length
    ? previous.blocks
    : normalizedItems.map((item, index): DailyPlanBlockRecord => ({
        id:item.dailyPlanBlockId,
        dailyPlanId:previous.plan.id,
        capabilityNodeId:item.capabilityNodeId,
        subject:(item.itemType === 'essay' ? 'essay' : 'aptitude') as DailyPlanBlockRecord['subject'],
        module:'',
        teachingGoalCode:'legacy_plan_item',
        sequence:index + 1,
        priority:item.priority,
        required:item.required
      }));
  const terminalItems = normalizedItems.filter(isTerminal);
  const retainedBlockIds = new Set(terminalItems.map((item) => item.dailyPlanBlockId));
  const blockIdMap = new Map<string, string>();
  const blocks = sourceBlocks
    .filter((block) => retainedBlockIds.has(block.id))
    .map((block, index): DailyPlanBlockRecord => {
      const nextId = ids.next('DailyPlanBlockId');
      blockIdMap.set(block.id, nextId);
      return { ...block, id: nextId, dailyPlanId: planId, sequence: index + 1 };
    });
  const itemIdMap = new Map(terminalItems.map((item) => [item.id, ids.next('DailyPlanItemId')]));
  const items = terminalItems.map((item, index): DailyPlanItemRecord => ({
    ...item,
    id: itemIdMap.get(item.id)!,
    dailyPlanId: planId,
    dailyPlanBlockId: blockIdMap.get(item.dailyPlanBlockId)!,
    dependencyIds: item.dependencyIds.flatMap((dependencyId) => {
      const nextId = itemIdMap.get(dependencyId);
      return nextId ? [nextId] : [];
    }),
    sequence: index + 1
  }));
  return { blocks, items };
}

function legacyCategory(itemType: DailyPlanItemRecord['itemType']): DailyPlanItemRecord['category'] {
  if (itemType === 'lecture') return 'learn';
  if (itemType === 'review') return 'review';
  if (itemType === 'diagnosis' || itemType === 'mock') return 'assess';
  if (itemType === 'digest') return 'accumulate';
  return 'practice';
}

function isTerminal(item: DailyPlanItemRecord): boolean {
  return item.status === DailyPlanItemStatus.Completed
    || item.status === DailyPlanItemStatus.Skipped
    || item.status === DailyPlanItemStatus.Cancelled;
}
