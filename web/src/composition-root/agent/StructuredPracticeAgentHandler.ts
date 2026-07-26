import type { ProviderGateway } from '@/capabilities/ai-runtime/public';
import {
  AssessmentRole,
  type CapabilityNodeId,
  type JsonObject,
  type ReviewQueueItemId
} from '@/kernel/public';
import {
  AgentRunAction,
  AgentRunType,
  TaskCenterStep,
  TaskTargetType,
  type AgentRunAggregate,
  type TransitionAgentRun,
  type TutorAgentHandler,
  type UpdateAgentRunProgress
} from '@/modules/agent/public';
import {
  GenerationSelectionAuthority,
  GenerationWorkflowStatus,
  QuestionSetEntryMode,
  type RunStructuredObjectiveGenerationWorkflow
} from '@/modules/content/public';
import {
  ReviewStatus,
  type FailReviewQueueItem,
  type MasteryRepository,
  type RetryReviewQueueItem,
  type StartReviewQueueItem
} from '@/modules/mastery/public';
import type { UpdateDailyPlanItemStatus } from '@/modules/planning/public';
import type { RequestStructuredPractice } from '@/modules/teaching/public';

export interface StructuredPracticeAgentDependencies {
  readonly requestPractice: RequestStructuredPractice;
  readonly runGeneration: RunStructuredObjectiveGenerationWorkflow;
  readonly updateProgress: UpdateAgentRunProgress;
  readonly transition: TransitionAgentRun;
  readonly updateDailyPlanItemStatus: UpdateDailyPlanItemStatus;
  readonly masteryRepository: MasteryRepository;
  readonly startReviewQueueItem: StartReviewQueueItem;
  readonly retryReviewQueueItem: RetryReviewQueueItem;
  readonly failReviewQueueItem: FailReviewQueueItem;
}

export function createStructuredPracticeAgentHandler(
  dependencies: StructuredPracticeAgentDependencies
): TutorAgentHandler {
  return {
    runType: AgentRunType.ContentGeneration,
    requiresGateway: true,
    execute: (run, gateway, signal) => executeStructuredPractice(run, gateway, signal, dependencies)
  };
}

async function executeStructuredPractice(
  run: AgentRunAggregate,
  gateway: ProviderGateway | undefined,
  signal: AbortSignal | undefined,
  dependencies: StructuredPracticeAgentDependencies
): Promise<void> {
  if (!gateway) throw new Error('Structured practice requires provider gateway');
  if (run.run.targetResourceType !== TaskTargetType.StructuredPractice) {
    throw new Error(`Unsupported structured practice target: ${run.run.targetResourceType || 'unknown'}`);
  }
  const snapshot = run.run.inputSnapshot;
  const dailyPlanItemId = text(snapshot.dailyPlanItemId);
  const reviewQueueItemId = text(snapshot.reviewQueueItemId) as ReviewQueueItemId | undefined;
  let reviewStarted = false;
  try {
    await progress(dependencies.updateProgress, run, TaskCenterStep.ResolvingPlan, 8, '正在读取今日计划和能力优先级', signal);
    if (dailyPlanItemId) {
      await dependencies.updateDailyPlanItemStatus.execute({ dailyPlanItemId, status: 'in_progress' });
    }
    if (reviewQueueItemId) {
      const current = await dependencies.masteryRepository.findReview(reviewQueueItemId);
      if (current?.status === ReviewStatus.Failed) {
        await dependencies.retryReviewQueueItem.execute(reviewQueueItemId);
      }
      await dependencies.startReviewQueueItem.execute(reviewQueueItemId);
      reviewStarted = true;
    }

    await progress(dependencies.updateProgress, run, TaskCenterStep.PreparingContext, 18, '正在准备个人画像、薄弱点和知识点上下文', signal);
    const aggregate = await dependencies.requestPractice.execute({
      idempotencyKey: `agent-run:${run.run.id}:practice`,
      capabilityNodeId: requiredText(snapshot.capabilityNodeId, 'capabilityNodeId') as CapabilityNodeId,
      assessmentRole: assessmentRole(snapshot.assessmentRole),
      requestedCount: number(snapshot.requestedCount, 'requestedCount'),
      difficultyMin: finiteNumber(snapshot.difficultyMin, 0.35),
      difficultyMax: finiteNumber(snapshot.difficultyMax, 0.68),
      goal: text(snapshot.goal),
      constraints: generationConstraints(snapshot, run.run.id)
    });
    if (aggregate.workflow.status === GenerationWorkflowStatus.Failed) {
      await dependencies.runGeneration.retry(aggregate.workflow.id);
    }

    const result = await dependencies.runGeneration.execute(
      aggregate.workflow.id,
      gateway,
      signal,
      async (step, message) => {
        const mapped = generationProgress(step);
        await progress(dependencies.updateProgress, run, mapped.step, mapped.value, message, signal, {
          workflowId: aggregate.workflow.id,
          learningThreadId: aggregate.spec.learningThreadId ?? null
        });
      }
    );
    signal?.throwIfAborted();
    if (!result.questionSetId || !aggregate.spec.learningThreadId) {
      throw new Error('题组未能发布');
    }
    await dependencies.transition.execute({
      idempotencyKey: `agent-run:${run.run.id}:completed`,
      agentRunId: run.run.id,
      action: AgentRunAction.Complete,
      reasonCode: 'structured_practice.completed',
      checkpoint: {
        ...run.run.checkpoint,
        step: TaskCenterStep.Completed,
        progress: 100,
        message: '讲义和题组已生成，可以开始练习',
        workflowId: aggregate.workflow.id,
        questionSetId: result.questionSetId,
        learningThreadId: aggregate.spec.learningThreadId,
        dailyPlanItemId: dailyPlanItemId || null,
        reviewQueueItemId: reviewQueueItemId || null,
        actionRoute: text(snapshot.completionActionRoute) || '/vue/practice/objective-session',
        actionParams: {
          questionSetId: result.questionSetId,
          learningThreadId: aggregate.spec.learningThreadId,
          dailyPlanItemId: dailyPlanItemId || null,
          reviewQueueItemId: reviewQueueItemId || null,
          durationMinutes: finiteNumber(snapshot.durationMinutes, Math.max(5, Math.ceil(number(snapshot.requestedCount, 'requestedCount') * 1.5)))
        }
      },
      payload: {
        questionSetId: result.questionSetId,
        learningThreadId: aggregate.spec.learningThreadId,
        workflowId: aggregate.workflow.id
      }
    });
  } catch (error) {
    if (dailyPlanItemId) {
      await dependencies.updateDailyPlanItemStatus.execute({
        dailyPlanItemId,
        status: 'pending',
        failureCode: signal?.aborted ? 'generation.cancelled' : errorCode(error),
        failureMessage: signal?.aborted ? '生成任务已取消，可以稍后重新开始。' : errorMessage(error)
      }).catch(() => undefined);
    }
    if (reviewStarted && reviewQueueItemId) {
      await dependencies.failReviewQueueItem.execute({
        reviewQueueItemId,
        failureCode: signal?.aborted ? 'review.cancelled' : errorCode(error)
      }).catch(() => undefined);
    }
    throw error;
  }
}

async function progress(
  updater: UpdateAgentRunProgress,
  run: AgentRunAggregate,
  step: Parameters<UpdateAgentRunProgress['execute']>[0]['step'],
  value: number,
  message: string,
  signal?: AbortSignal,
  data?: JsonObject
): Promise<void> {
  signal?.throwIfAborted();
  await updater.execute({ agentRunId: run.run.id, step, progress: value, message, data });
}

function generationProgress(step: string) {
  if (step === 'compiling_prompt') return { step: TaskCenterStep.CompilingPrompt, value: 30 };
  if (step === 'invoking_model') return { step: TaskCenterStep.InvokingModel, value: 42 };
  if (step === 'parsing_response') return { step: TaskCenterStep.ParsingResponse, value: 74 };
  if (step === 'validating_content') return { step: TaskCenterStep.ValidatingContent, value: 84 };
  return { step: TaskCenterStep.CommittingResult, value: 94 };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 240);
  return '生成练习失败，请稍后重试。';
}

function assessmentRole(value: unknown) {
  const role = text(value);
  return Object.values(AssessmentRole).includes(role as never)
    ? role as typeof AssessmentRole[keyof typeof AssessmentRole]
    : AssessmentRole.Practice;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredText(value: unknown, field: string): string {
  const parsed = text(value);
  if (!parsed) throw new Error(`Structured practice input is missing ${field}`);
  return parsed;
}

function number(value: unknown, field: string): number {
  const parsed = finiteNumber(value, Number.NaN);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 25) {
    throw new Error(`Structured practice input has invalid ${field}`);
  }
  return parsed;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function generationConstraints(snapshot: JsonObject, agentRunId: string): JsonObject {
  const entryMode = text(snapshot.entryMode) === QuestionSetEntryMode.Tutor
    ? QuestionSetEntryMode.Tutor
    : QuestionSetEntryMode.Self;
  const common: JsonObject = {
    source: text(snapshot.source) || (entryMode === QuestionSetEntryMode.Tutor ? 'daily_plan' : 'custom'),
    entryMode,
    selectionAuthority: entryMode === QuestionSetEntryMode.Tutor
      ? GenerationSelectionAuthority.TutorEngine
      : GenerationSelectionAuthority.User,
    capabilityCode: text(snapshot.capabilityCode) || null,
    capabilityName: text(snapshot.capabilityName) || null,
    durationMinutes: finiteNumber(
      snapshot.durationMinutes,
      Math.max(5, Math.ceil(number(snapshot.requestedCount, 'requestedCount') * 1.5))
    ),
    agentRunId
  };
  if (entryMode === QuestionSetEntryMode.Self) return common;
  return {
    ...common,
    dailyPlanId: text(snapshot.dailyPlanId) || null,
    dailyPlanItemId: text(snapshot.dailyPlanItemId) || null,
    reviewQueueItemId: text(snapshot.reviewQueueItemId) || null
  };
}

function errorCode(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'structured_practice.failed';
}
