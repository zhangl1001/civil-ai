import type { Clock, ExamCycleId } from '@/kernel/public';
import type { MasteryRepository } from '../contracts/MasteryRepository';
import { proposeDailyPlan, type DailyPlanProposal } from '../domain/DailyPlanPolicy';

export class BuildDailyPlanProposal {
  constructor(private readonly mastery: MasteryRepository, private readonly clock: Clock) {}

  async execute(command: { readonly examCycleId: ExamCycleId; readonly availableMinutes: number }): Promise<DailyPlanProposal> {
    const [dueReviews, priorityTracks] = await Promise.all([
      this.mastery.listDueReviews(command.examCycleId, this.clock.now(), 12),
      this.mastery.listPriorityTracks(command.examCycleId, 8)
    ]);
    return proposeDailyPlan({ ...command, dueReviews, priorityTracks });
  }
}
