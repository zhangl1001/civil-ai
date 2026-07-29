import type { initializeTutorRuntime } from '@/composition-root/public';
import type { AssessmentRole } from '@/kernel/public';
import type { CommittedQuestionSetBundle } from '@/modules/content/public';

export interface SubmitPracticeBundleCommand {
  readonly runtime: Awaited<ReturnType<typeof initializeTutorRuntime>>;
  readonly bundle: CommittedQuestionSetBundle;
  readonly learningThreadId: string;
  readonly submissionScope: string;
  readonly startedAt: number;
  readonly answers: Readonly<Record<string, string>>;
  readonly elapsedByQuestion: Readonly<Record<string, number>>;
  readonly answerChanges: Readonly<Record<string, number>>;
  readonly assessmentRoleOverride?: AssessmentRole;
  readonly reviewQueueItemId?: string;
  readonly dailyPlanItemId?: string;
}

export function submitPracticeBundle(command: SubmitPracticeBundleCommand) {
  const runtime = command.runtime;
  return runtime.submitObjectiveSession.execute({
    idempotencyKey: `practice:submit:${command.submissionScope}:${command.bundle.questionSet.id}:${command.learningThreadId}`,
    learningThreadId: command.learningThreadId as Parameters<typeof runtime.submitObjectiveSession.execute>[0]['learningThreadId'],
    questionSetId: command.bundle.questionSet.id,
    questionIds: command.bundle.questions.map((item) => item.id),
    assessmentRole: command.assessmentRoleOverride,
    reviewQueueItemId: command.reviewQueueItemId as Parameters<typeof runtime.submitObjectiveSession.execute>[0]['reviewQueueItemId'],
    dailyPlanItemId: command.dailyPlanItemId,
    startedAt: command.startedAt as Parameters<typeof runtime.submitObjectiveSession.execute>[0]['startedAt'],
    elapsedMs: Date.now() - command.startedAt,
    answers: command.bundle.questions.map((item) => ({
      questionId: item.id,
      optionId: command.answers[item.id],
      elapsedMs: command.elapsedByQuestion[item.id],
      answerChangeCount: command.answerChanges[item.id] || 0
    }))
  });
}
