import type { ExamCycleId, JsonObject } from '@/kernel/public';
import { DailyPlanItemStatus, DailyPlanRebalanceReason } from '../domain/DailyPlanCodes';
import type { DailyPlanItemRecord } from '../contracts/DailyPlanRepository';

interface CurrentCyclePort {
  findCurrentCycle(): Promise<{ readonly examCycle: { readonly id: ExamCycleId } } | undefined>;
}

interface UpdatePlanItemPort {
  execute(command: {
    readonly dailyPlanItemId: string;
    readonly status: DailyPlanItemRecord['status'];
    readonly actualMinutes?: number;
    readonly resultSummary?: JsonObject;
  }): Promise<DailyPlanItemRecord | undefined>;
}

interface RebalancePlanPort {
  execute(command: {
    readonly examCycleId: ExamCycleId;
    readonly reason: typeof DailyPlanRebalanceReason.LearningResult;
    readonly sourceId: string;
  }): Promise<unknown>;
}

/** Completes a user learning action and then derives the remaining daily plan. */
export class CompleteDailyPlanItem {
  constructor(
    private readonly candidates: CurrentCyclePort,
    private readonly updateItem: UpdatePlanItemPort,
    private readonly rebalance: RebalancePlanPort
  ) {}

  async execute(command: {
    readonly dailyPlanItemId: string;
    readonly actualMinutes?: number;
    readonly resultSummary?: JsonObject;
    readonly sourceId?: string;
  }): Promise<DailyPlanItemRecord> {
    const dailyPlanItemId = command.dailyPlanItemId.trim();
    if (!dailyPlanItemId) throw new Error('Daily plan item ID is required');
    const cycle = await this.candidates.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const item = await this.updateItem.execute({
      dailyPlanItemId,
      status: DailyPlanItemStatus.Completed,
      actualMinutes: command.actualMinutes,
      resultSummary: command.resultSummary
    });
    if (!item) throw new Error('今日计划项已失效，请刷新计划后重试。');
    await this.rebalance.execute({
      examCycleId: cycle.examCycle.id,
      reason: DailyPlanRebalanceReason.LearningResult,
      sourceId: command.sourceId?.trim() || `daily-plan-item:${dailyPlanItemId}:completed`
    });
    return item;
  }
}
