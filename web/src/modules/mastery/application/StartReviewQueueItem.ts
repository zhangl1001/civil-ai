import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, ReviewQueueItemId } from '@/kernel/public';
import type { MasteryRepository, ReviewQueueItem } from '../contracts/MasteryRepository';
import { ReviewStatus } from '../domain/MasteryCodes';

/** Claims a due review before any content generation starts. */
export class StartReviewQueueItem {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly repository: MasteryRepository, private readonly clock: Clock) {}

  async execute(reviewQueueItemId: ReviewQueueItemId): Promise<ReviewQueueItem> {
    const current = await this.repository.findReview(reviewQueueItemId);
    if (!current) throw new Error(`Review queue item does not exist: ${reviewQueueItemId}`);
    if (current.status === ReviewStatus.InProgress) return current;
    if (current.status !== ReviewStatus.Scheduled) throw new Error(`Review queue item cannot start from ${current.status}`);
    const now = this.clock.now();
    const next: ReviewQueueItem = { ...current, status: ReviewStatus.InProgress, claimedAt: now, completedAt: undefined, failureCode: undefined, version: current.version + 1, updatedAt: now };
    await this.unitOfWork.run((context) => this.repository.replaceReview(next, current.version, context));
    return next;
  }
}
