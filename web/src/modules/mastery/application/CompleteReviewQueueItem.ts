import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, ReviewQueueItemId } from '@/kernel/public';
import type { MasteryRepository, ReviewQueueItem } from '../contracts/MasteryRepository';
import { ReviewStatus } from '../domain/MasteryCodes';

/** Marks a linked review complete only after the objective session is committed. */
export class CompleteReviewQueueItem {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly repository: MasteryRepository, private readonly clock: Clock) {}

  async execute(reviewQueueItemId: ReviewQueueItemId): Promise<ReviewQueueItem> {
    const current = await this.repository.findReview(reviewQueueItemId);
    if (!current) throw new Error(`Review queue item does not exist: ${reviewQueueItemId}`);
    if (current.status === ReviewStatus.Completed) return current;
    if (current.status !== ReviewStatus.InProgress) throw new Error(`Review queue item cannot complete from ${current.status}`);
    const now = this.clock.now();
    const next: ReviewQueueItem = { ...current, status: ReviewStatus.Completed, completedAt: now, failureCode: undefined, version: current.version + 1, updatedAt: now };
    await this.unitOfWork.run((context) => this.repository.replaceReview(next, current.version, context));
    return next;
  }
}
