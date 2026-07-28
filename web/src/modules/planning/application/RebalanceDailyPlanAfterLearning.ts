import type { Clock, ExamCycleId, LocalDate, TimeZoneId } from '@/kernel/public';
import type { DailyPlanProposal } from '@/modules/mastery/public';
import type { DailyPlanAggregate, DailyPlanRepository } from '../contracts/DailyPlanRepository';
import { DailyPlanItemStatus, type DailyPlanRebalanceReason } from '../domain/DailyPlanCodes';
import type { PersistDailyPlanProposal } from './PersistDailyPlanProposal';

interface CandidatePlanContext {
  readonly examCycle: { readonly id: ExamCycleId; readonly phase: string; readonly timeZone: TimeZoneId; readonly examDate: string };
  readonly studyConstraints: { readonly weekdayMinutes: number; readonly weekendMinutes: number };
}

interface CandidatePlanContextPort {
  findCycle(examCycleId: ExamCycleId): Promise<CandidatePlanContext | undefined>;
}

interface DailyPlanProposalPort {
  execute(command: { readonly examCycleId: ExamCycleId; readonly availableMinutes: number; readonly examDate?: string; readonly phase?: string }): Promise<DailyPlanProposal>;
}

export class RebalanceDailyPlanAfterLearning {
  constructor(
    private readonly candidates: CandidatePlanContextPort,
    private readonly plans: DailyPlanRepository,
    private readonly proposals: DailyPlanProposalPort,
    private readonly persist: PersistDailyPlanProposal,
    private readonly clock: Clock
  ) {}

  async execute(command: {
    readonly examCycleId: ExamCycleId;
    readonly reason: DailyPlanRebalanceReason;
    readonly sourceId: string;
  }): Promise<DailyPlanAggregate | undefined> {
    const cycle = await this.candidates.findCycle(command.examCycleId);
    if (!cycle) return undefined;
    const planDate = localDate(this.clock.now(), cycle.examCycle.timeZone);
    const current = await this.plans.findCurrent(command.examCycleId, planDate);
    if (!current) return undefined;
    if (current.plan.decisionFactors.sourceId === command.sourceId) return current;
    const usedMinutes = current.items
      .filter((item) => item.status === DailyPlanItemStatus.Completed)
      .reduce((total, item) => total + Math.max(item.actualMinutes, 1), 0);
    const remainingMinutes = Math.max(0, current.plan.availableMinutes - usedMinutes);
    if (remainingMinutes < 5) return current;
    const proposal = await this.proposals.execute({
      examCycleId: command.examCycleId,
      availableMinutes: remainingMinutes,
      examDate: cycle.examCycle.examDate,
      phase: cycle.examCycle.phase
    });
    return this.persist.execute({
      proposal,
      planDate,
      phase: cycle.examCycle.phase,
      retainTerminalItems: true,
      availableMinutes: current.plan.availableMinutes,
      decisionFactors: {
        rebalanceReason: command.reason,
        sourceId: command.sourceId,
        remainingMinutes,
        previousPlanId: current.plan.id
      }
    });
  }
}

function localDate(now: number, timeZone: TimeZoneId): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(now));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}` as LocalDate;
}
