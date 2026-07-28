import type { Clock, ExamCycleId } from '@/kernel/public';
import type { MasteryRepository } from '../contracts/MasteryRepository';
import { proposeDailyPlan, type DailyPlanProposal } from '../domain/DailyPlanPolicy';

export class BuildDailyPlanProposal {
  constructor(private readonly mastery: MasteryRepository, private readonly clock: Clock) {}

  async execute(command: {
    readonly examCycleId: ExamCycleId;
    readonly availableMinutes: number;
    readonly examDate?: string;
    readonly phase?: string;
  }): Promise<DailyPlanProposal> {
    const [dueReviews, priorityTracks] = await Promise.all([
      this.mastery.listDueReviews(command.examCycleId, this.clock.now(), 12),
      this.mastery.listPriorityTracks(command.examCycleId, 8)
    ]);
    return proposeDailyPlan({
      ...command,
      dueReviews,
      priorityTracks,
      remainingDays: command.examDate ? daysUntil(command.examDate, this.clock.now()) : undefined
    });
  }
}

function daysUntil(date: string, now: number): number | undefined {
  const target = Date.parse(`${date}T12:00:00`);
  if (!Number.isFinite(target)) return undefined;
  return Math.max(0, Math.ceil((target - now) / 86_400_000));
}
