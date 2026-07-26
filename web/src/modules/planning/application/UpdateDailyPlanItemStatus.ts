import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, JsonObject } from '@/kernel/public';
import type { DailyPlanItemRecord, DailyPlanRepository } from '../contracts/DailyPlanRepository';
import { DailyPlanItemStatus } from '../domain/DailyPlanCodes';

export interface UpdateDailyPlanItemStatusCommand {
  readonly dailyPlanItemId?: string;
  readonly reviewQueueItemId?: string;
  readonly status: DailyPlanItemRecord['status'];
  readonly actualMinutes?: number;
  readonly resultSummary?: JsonObject;
  readonly failureCode?: string;
  readonly failureMessage?: string;
}

export class UpdateDailyPlanItemStatus {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: DailyPlanRepository,
    private readonly clock: Clock
  ) {}

  async execute(command: UpdateDailyPlanItemStatusCommand): Promise<DailyPlanItemRecord | undefined> {
    if (command.actualMinutes !== undefined && (!Number.isInteger(command.actualMinutes) || command.actualMinutes < 0)) {
      throw new RangeError('Actual plan item minutes must be a non-negative integer');
    }
    const terminal = command.status === DailyPlanItemStatus.Completed
      || command.status === DailyPlanItemStatus.Skipped
      || command.status === DailyPlanItemStatus.Cancelled;
    const patch = {
      status: command.status,
      actualMinutes: command.actualMinutes,
      resultSummary: command.resultSummary,
      failureCode: clean(command.failureCode),
      failureMessage: clean(command.failureMessage),
      finishedAt: terminal ? this.clock.now() : undefined
    };
    if (command.dailyPlanItemId) {
      return this.unitOfWork.run((context) => this.repository.updateItemById(command.dailyPlanItemId!, patch, context));
    }
    if (command.reviewQueueItemId) {
      return this.unitOfWork.run((context) => this.repository.updateItemByReviewQueueId(command.reviewQueueItemId!, patch, context));
    }
    throw new Error('Daily plan item ID or review queue item ID is required');
  }
}

function clean(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}
