import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, ReviewQueueItemId } from '@/kernel/public';
import type { MasteryRepository, ReviewQueueItem } from '../contracts/MasteryRepository';
import { ReviewStatus } from '../domain/MasteryCodes';

/** Reopens a failed review queue item for another execution attempt. */
export class RetryReviewQueueItem {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly repository: MasteryRepository, private readonly clock: Clock) {}

  async execute(reviewQueueItemId: ReviewQueueItemId): Promise<ReviewQueueItem> {
    const current = await this.repository.findReview(reviewQueueItemId);
    if (!current) throw new Error(`Review queue item does not exist: ${reviewQueueItemId}`);
    if (current.status === ReviewStatus.Scheduled || current.status === ReviewStatus.InProgress) return current;
    if (current.status !== ReviewStatus.Failed) throw new Error(`Review queue item cannot retry from ${current.status}`);

    const now = this.clock.now();
    const next: ReviewQueueItem = {
      ...current,
      status: ReviewStatus.Scheduled,
      claimedAt: undefined,
      completedAt: undefined,
      failureCode: undefined,
      dueAt: now,
      version: current.version + 1,
      updatedAt: now
    };
    await this.unitOfWork.run((context) => this.repository.replaceReview(next, current.version, context));
    return next;
  }
}
