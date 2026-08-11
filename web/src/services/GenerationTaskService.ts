import { agentWorkerCoordinator } from '@/composition-root/agent/AgentWorkerCoordinator';
import { initializeTutorRuntime, type TutorDatabaseRuntime } from '@/composition-root/public';
import type { JsonObject, JsonValue } from '@/kernel/public';
import {
  AgentRunType,
  TaskTargetType,
  type AgentRunView
} from '@/modules/agent/public';
import {
  MessageBusinessLine,
  MessageCategory,
  MessageEventCode,
  MessageSeverity,
  MessageSourceType
} from '@/modules/message-center/public';

export type GenerationIntent =
  | 'daily'
  | 'practice'
  | 'essayGrade'
  | 'mock'
  | 'redo'
  | 'digest'
  | 'monthlyDigest'
  | 'study'
  | 'interviewReview'
  | 'trueQuestionResearch';

export interface GenerationTaskInput {
  readonly intent: GenerationIntent;
  readonly idempotencyKey?: string;
  readonly title?: string;
  readonly detail?: string;
  readonly module?: string;
  readonly sourceId?: string;
  readonly payload?: Record<string, unknown>;
}

export interface AgentTaskEnqueueResult {
  readonly task: AgentRunView;
  readonly reused: boolean;
  readonly reason?: string;
}

const TITLE_BY_INTENT: Record<GenerationIntent, string> = {
  daily: '每日积累',
  practice: '生成练习',
  essayGrade: '申论批改',
  mock: '生成模考',
  redo: '错题重练',
  digest: '学习复盘',
  monthlyDigest: '时政月报',
  study: '考点精讲',
  interviewReview: '面试深度点评',
  trueQuestionResearch: '联网真题研究'
};

export class GenerationTaskService {
  async enqueue(input: GenerationTaskInput): Promise<AgentTaskEnqueueResult> {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) {
      throw new Error('当前还没有完整备考档案，请先补全目标、现状和学习时间。');
    }
    const projectId = cycle?.project.id ?? 'unbound';
    const scopeKey = taskScope(projectId, input);
    const active = await runtime.getAgentRunViews.findActiveByTarget(TaskTargetType.BusinessOperation, scopeKey);
    if (active) {
      agentWorkerCoordinator.start(runtime);
      return { task: active, reused: true, reason: 'active_scope' };
    }

    const title = input.title || TITLE_BY_INTENT[input.intent];
    const detail = input.detail || input.module || '准备执行';
    const actionRoute = routeForInput(input);
    const actionParams = actionParamsForInput(input);
    const dailyPlanItemId = optionalText(input.payload?.dailyPlanItemId);
    const capabilityNodeId = optionalText(input.payload?.capabilityNodeId);
    const aggregate = await runtime.createAgentRun.execute({
      idempotencyKey: input.idempotencyKey?.trim()
        || `business:${scopeKey}:${crypto.randomUUID()}`,
      runType: runTypeForIntent(input.intent),
      examCycleId: cycle?.examCycle.id,
      targetResourceType: TaskTargetType.BusinessOperation,
      targetResourceId: scopeKey,
      inputSnapshot: {
        projectId,
        intent: input.intent,
        title,
        detail,
        module: input.module ?? null,
        sourceId: input.sourceId ?? null,
        dailyPlanItemId: dailyPlanItemId ?? null,
        capabilityNodeId: capabilityNodeId ?? null,
        payload: toJsonObject(input.payload || {}),
        scopeKey,
        businessLine: businessLineForIntent(input.intent),
        category: MessageCategory.Task,
        actionRoute,
        actionParams
      }
    });
    await runtime.messageCenter.publish({
      businessLine: businessLineForIntent(input.intent),
      category: MessageCategory.Task,
      eventCode: MessageEventCode.TaskQueued,
      severity: MessageSeverity.Info,
      title,
      content: detail,
      sourceType: MessageSourceType.AgentRun,
      sourceId: aggregate.run.id,
      actionRoute,
      actionParams,
      dedupKey: `agent-run:${aggregate.run.id}:queued`
    }).catch(() => undefined);
    agentWorkerCoordinator.start(runtime);
    return {
      task: await requireRunView(runtime, aggregate.run.id),
      reused: false
    };
  }
}

async function requireRunView(runtime: TutorDatabaseRuntime, id: AgentRunView['id']): Promise<AgentRunView> {
  const run = await runtime.getAgentRunViews.findById(id);
  if (!run) throw new Error('任务创建后无法读取');
  return run;
}

function taskScope(projectId: string, input: GenerationTaskInput): string {
  const source = input.sourceId || input.module || input.intent;
  return `${input.intent}:${projectId}:${source}`;
}

function runTypeForIntent(intent: GenerationIntent): AgentRunType {
  if (intent === 'daily' || intent === 'monthlyDigest') return AgentRunType.TeachingPlan;
  if (intent === 'essayGrade' || intent === 'interviewReview') return AgentRunType.TutorTurn;
  return AgentRunType.ContentGeneration;
}

function businessLineForIntent(intent: GenerationIntent) {
  if (intent === 'practice') return MessageBusinessLine.Practice;
  if (intent === 'redo') return MessageBusinessLine.Review;
  if (intent === 'essayGrade') return MessageBusinessLine.Essay;
  if (intent === 'interviewReview') return MessageBusinessLine.Interview;
  if (intent === 'mock') return MessageBusinessLine.Exam;
  if (intent === 'trueQuestionResearch') return MessageBusinessLine.Practice;
  if (intent === 'daily' || intent === 'digest' || intent === 'monthlyDigest') return MessageBusinessLine.Digest;
  return MessageBusinessLine.Tutor;
}

function routeForInput(input: GenerationTaskInput): string {
  const intent = input.intent;
  if (intent === 'practice' || intent === 'redo') return '/vue/practice/session';
  if (intent === 'essayGrade') return '/vue/essay';
  if (intent === 'interviewReview') return '/vue/interview';
  if (intent === 'mock') return input.payload?.subject === '申论' ? '/vue/essay' : '/vue/exam';
  if (intent === 'monthlyDigest') return '/vue/monthly-digest';
  if (intent === 'trueQuestionResearch') return '/vue/practice';
  if (intent === 'daily' || intent === 'digest') return '/vue/digest';
  return '/vue/study';
}

function actionParamsForInput(input: GenerationTaskInput): JsonObject {
  const linkage = {
    ...(optionalText(input.payload?.dailyPlanItemId) ? { dailyPlanItemId: optionalText(input.payload?.dailyPlanItemId)! } : {}),
    ...(optionalText(input.payload?.capabilityNodeId) ? { capabilityNodeId: optionalText(input.payload?.capabilityNodeId)! } : {}),
    ...(optionalText(input.payload?.reviewQueueItemId) ? { reviewQueueItemId: optionalText(input.payload?.reviewQueueItemId)! } : {})
  };
  if (input.intent === 'trueQuestionResearch') return { mode: 'true', ...linkage };
  return linkage;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]));
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === 'object') return toJsonObject(value as Record<string, unknown>);
  return null;
}

export const generationTaskService = new GenerationTaskService();
