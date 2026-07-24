import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, ReviewQueueItemId } from '@/kernel/public';
import type { MasteryRepository, ReviewQueueItem } from '../contracts/MasteryRepository';
import { ReviewStatus } from '../domain/MasteryCodes';

/** Records a failed review execution so the UI can retry without losing the queue item. */
export class FailReviewQueueItem {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly repository: MasteryRepository, private readonly clock: Clock) {}

  async execute(command: { readonly reviewQueueItemId: ReviewQueueItemId; readonly failureCode: string }): Promise<ReviewQueueItem> {
    const current = await this.repository.findReview(command.reviewQueueItemId);
    if (!current) throw new Error(`Review queue item does not exist: ${command.reviewQueueItemId}`);
    if (current.status === ReviewStatus.Completed) return current;
    if (current.status === ReviewStatus.Failed) return current;
    if (current.status !== ReviewStatus.InProgress) throw new Error(`Review queue item cannot fail from ${current.status}`);

    const now = this.clock.now();
    const next: ReviewQueueItem = {
      ...current,
      status: ReviewStatus.Failed,
      failureCode: normalizeFailureCode(command.failureCode),
      version: current.version + 1,
      updatedAt: now
    };
    await this.unitOfWork.run((context) => this.repository.replaceReview(next, current.version, context));
    return next;
  }
}

function normalizeFailureCode(value: string): string {
  const code = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return code || 'unknown_failure';
}
