import type { UnitOfWork } from '@/capabilities/database/public';
import type { DailyPlanItemRecord, DailyPlanRepository } from '../contracts/DailyPlanRepository';

export interface UpdateDailyPlanItemStatusCommand {
  readonly reviewQueueItemId: string;
  readonly status: DailyPlanItemRecord['status'];
  readonly actualMinutes?: number;
}

export class UpdateDailyPlanItemStatus {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly repository: DailyPlanRepository) {}

  async execute(command: UpdateDailyPlanItemStatusCommand): Promise<DailyPlanItemRecord | undefined> {
    return this.unitOfWork.run((context) => this.repository.updateItemByReviewQueueId(command.reviewQueueItemId, {
      status: command.status,
      actualMinutes: command.actualMinutes
    }, context));
  }
}
