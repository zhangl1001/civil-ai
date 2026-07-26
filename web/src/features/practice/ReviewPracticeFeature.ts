import type { ProviderGateway } from '@/capabilities/ai-runtime/public';
import type { TutorDatabaseRuntime } from '@/composition-root/public';
import { AssessmentRole, type ReviewQueueItemId } from '@/kernel/public';
import { ReviewStatus } from '@/modules/mastery/public';
import { LearningThreadOrigin, LearningThreadStage } from '@/modules/teaching/public';

/** Adapts a scheduled review into a linked thread, generated question set, and later learning session. */
export class ReviewPracticeFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async start(reviewQueueItemId: ReviewQueueItemId, gateway: ProviderGateway, signal?: AbortSignal) {
    const current = await this.runtime.masteryRepository.findReview(reviewQueueItemId);
    if (current?.status === ReviewStatus.Failed) {
      await this.runtime.retryReviewQueueItem.execute(reviewQueueItemId);
    }
    const review = await this.runtime.startReviewQueueItem.execute(reviewQueueItemId);
    await this.runtime.updateDailyPlanItemStatus.execute({ reviewQueueItemId: review.id, status: 'in_progress' });
    const assessmentRole = review.reviewType === 'transfer' ? AssessmentRole.Transfer : review.reviewType === 'anchor' ? AssessmentRole.Anchor : AssessmentRole.Retention;
    const stage = assessmentRole === AssessmentRole.Transfer ? LearningThreadStage.Transfer : LearningThreadStage.Retention;
    try {
      const thread = await this.runtime.createLearningThread.execute({
        idempotencyKey: `review:${review.id}:thread:${review.version}`,
        examCycleId: review.examCycleId,
        capabilityNodeId: review.capabilityNodeId,
        originType: LearningThreadOrigin.DailyPlan,
        originRefId: review.id,
        goal: `完成${review.reviewType === 'repair' ? '薄弱点修复' : '间隔复习'}并验证当前掌握情况`,
        gapSnapshot: { reviewQueueItemId: review.id, reason: review.reason, priority: review.priority, attemptVersion: review.version },
        initialStage: stage,
        exitCriteria: { reviewQueueItemId: review.id, requireObjectiveSubmission: true }
      });
      const aggregate = await this.runtime.createGenerationWorkflow.execute({
        idempotencyKey: `review:${review.id}:generation:${review.version}`,
        examCycleId: review.examCycleId,
        learningThreadId: thread.thread.id,
        capabilityNodeId: review.capabilityNodeId,
        assessmentRole,
        requestedCount: 4,
        difficultyMin: review.reviewType === 'repair' ? 0.25 : 0.4,
        difficultyMax: review.reviewType === 'transfer' ? 0.8 : 0.65,
        constraints: { reviewQueueItemId: review.id, reviewType: review.reviewType, reason: review.reason, attemptVersion: review.version }
      });
      const result = await this.runtime.runStructuredObjectiveGenerationWorkflow.execute(aggregate.workflow.id, gateway, signal);
      if (!result.questionSetId) throw new Error('复习题组未能发布。');
      return { review, thread: thread.thread, questionSetId: result.questionSetId };
    } catch (cause) {
      await this.runtime.failReviewQueueItem.execute({ reviewQueueItemId: review.id, failureCode: failureCode(cause) });
      await this.runtime.updateDailyPlanItemStatus.execute({ reviewQueueItemId: review.id, status: 'pending' });
      throw cause;
    }
  }
}

function failureCode(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'review_generation_failed';
}
