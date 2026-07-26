import type { ExamCycleId, JsonObject, LearningSessionId } from '@/kernel/public';
import { contentDocumentText } from '@/modules/content/public';
import { ErrorCauseCode } from '../domain/EvidenceCodes';
import type { GetObjectiveSessionReview, ObjectiveSessionReviewItem } from './GetObjectiveSessionReview';
import type { RequestAiErrorDiagnosis } from './RequestAiErrorDiagnosis';

interface MasteryRefreshPort {
  execute(command: { readonly examCycleId: string; readonly capabilityNodeId: string }): Promise<unknown>;
}

interface ReviewCompletionPort {
  execute(reviewQueueItemId: string): Promise<unknown>;
}

interface DailyPlanItemStatusPort {
  execute(command: {
    readonly dailyPlanItemId?: string;
    readonly reviewQueueItemId?: string;
    readonly status: 'completed';
    readonly actualMinutes: number;
    readonly resultSummary: JsonObject;
  }): Promise<unknown>;
}

interface DailyPlanRebalancePort {
  execute(command: { readonly examCycleId: ExamCycleId; readonly sourceId: string }): Promise<unknown>;
}

interface ProactiveTutorRefreshPort {
  execute(examCycleId: string): Promise<unknown>;
}

export interface ObjectiveSubmissionPostProcessCommand {
  readonly idempotencyKey: string;
  readonly sessionId: LearningSessionId;
  readonly reviewQueueItemId?: string;
  readonly dailyPlanItemId?: string;
  readonly elapsedMs: number;
}

export interface ObjectiveSubmissionPostProcessResult {
  readonly diagnosisRunIds: readonly string[];
  readonly pendingSteps: readonly string[];
}

/**
 * Owns every derived effect of an objective submission. The committed session is the source of truth;
 * this use case can be invoked repeatedly by both the foreground flow and the durable outbox worker.
 */
export class ObjectiveSubmissionPostProcessor {
  constructor(
    private readonly review: GetObjectiveSessionReview,
    private readonly requestDiagnosis: RequestAiErrorDiagnosis,
    private readonly refreshMastery?: MasteryRefreshPort,
    private readonly completeReview?: ReviewCompletionPort,
    private readonly updateDailyPlanItem?: DailyPlanItemStatusPort,
    private readonly rebalanceDailyPlan?: DailyPlanRebalancePort,
    private readonly refreshProactiveTutor?: ProactiveTutorRefreshPort
  ) {}

  async execute(
    command: ObjectiveSubmissionPostProcessCommand,
    contexts: Readonly<Record<string, JsonObject>> = {}
  ): Promise<ObjectiveSubmissionPostProcessResult> {
    const pendingSteps: string[] = [];
    const sessionReview = await attempt('session_review.load', pendingSteps, () => this.review.execute(command.sessionId));
    if (!sessionReview) {
      return { diagnosisRunIds: [], pendingSteps: unique([...pendingSteps, 'session_review.missing']) };
    }

    const resultSummary: JsonObject = {
      sessionId: sessionReview.session.id,
      total: sessionReview.session.questionCount,
      answered: sessionReview.session.answeredCount,
      correct: sessionReview.session.correctCount,
      incorrect: sessionReview.session.answeredCount - sessionReview.session.correctCount,
      unanswered: sessionReview.session.questionCount - sessionReview.session.answeredCount
    };
    const actualMinutes = Math.max(1, Math.round(command.elapsedMs / 60_000));

    if (command.reviewQueueItemId) {
      await attempt('review.complete', pendingSteps, () => this.completeReview?.execute(command.reviewQueueItemId!));
      await attempt('daily_plan.complete', pendingSteps, () => this.updateDailyPlanItem?.execute({
        reviewQueueItemId: command.reviewQueueItemId,
        status: 'completed',
        actualMinutes,
        resultSummary
      }));
    } else if (command.dailyPlanItemId) {
      await attempt('daily_plan.complete', pendingSteps, () => this.updateDailyPlanItem?.execute({
        dailyPlanItemId: command.dailyPlanItemId,
        status: 'completed',
        actualMinutes,
        resultSummary
      }));
    }

    const capabilities = new Map(
      sessionReview.items.map((item) => [item.attempt.capabilityNodeId, item.attempt.examCycleId])
    );
    await Promise.all(Array.from(capabilities.entries()).map(([capabilityNodeId, examCycleId]) => (
      attempt('mastery.refresh', pendingSteps, () => this.refreshMastery?.execute({
        examCycleId,
        capabilityNodeId
      }))
    )));
    const projectionBlocked = pendingSteps.includes('daily_plan.complete')
      || pendingSteps.includes('mastery.refresh');
    if (projectionBlocked) {
      pendingSteps.push('daily_plan.rebalance', 'proactive_tutor.refresh');
    } else {
      await attempt('daily_plan.rebalance', pendingSteps, () => this.rebalanceDailyPlan?.execute({
        examCycleId: sessionReview.session.examCycleId as ExamCycleId,
        sourceId: sessionReview.session.id
      }));
      if (pendingSteps.includes('daily_plan.rebalance')) {
        pendingSteps.push('proactive_tutor.refresh');
      } else {
        await attempt(
          'proactive_tutor.refresh',
          pendingSteps,
          () => this.refreshProactiveTutor?.execute(sessionReview.session.examCycleId)
        );
      }
    }

    const diagnosisItems = sessionReview.items
      .filter((item) => item.grading.result === 'incorrect')
      .flatMap((item) => item.diagnoses
        .filter((diagnosis) => diagnosis.source === 'deterministic' && diagnosis.causeCode === ErrorCauseCode.Unknown)
        .map((diagnosis) => ({
          provisionalDiagnosisId: diagnosis.id,
          evidenceContext: contexts[item.question.id] ?? evidenceContext(item)
        })));
    const diagnosisRunIds: string[] = [];
    if (diagnosisItems.length) {
      const run = await attempt('error_diagnosis.enqueue', pendingSteps, () => this.requestDiagnosis.execute({
        idempotencyKey: `${command.idempotencyKey}:ai-diagnosis-batch:v1`,
        sessionId: sessionReview.session.id,
        items: diagnosisItems
      }));
      if (run) diagnosisRunIds.push(run.run.id);
    }

    return { diagnosisRunIds, pendingSteps: unique(pendingSteps) };
  }
}

function evidenceContext(item: ObjectiveSessionReviewItem): JsonObject {
  return {
    question: {
      material: item.question.content.material ? contentDocumentText(item.question.content.material) : null,
      prompt: contentDocumentText(item.question.content.prompt),
      options: item.question.content.options.map((option) => ({
        id: option.id,
        content: contentDocumentText(option.content)
      })),
      explanation: contentDocumentText(item.question.content.explanation)
    },
    standardAnswer: item.question.content.correctOptionId,
    userAnswer: typeof item.attempt.answer.optionId === 'string' ? item.attempt.answer.optionId : null,
    deterministicResult: item.grading.result,
    observations: {
      elapsedMs: item.attempt.elapsedMs ?? null,
      answerChangeCount: item.attempt.answerChangeCount
    }
  };
}

async function attempt<T>(
  step: string,
  pendingSteps: string[],
  work: () => Promise<T> | undefined
): Promise<T | undefined> {
  try {
    return await work();
  } catch {
    pendingSteps.push(step);
    return undefined;
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
