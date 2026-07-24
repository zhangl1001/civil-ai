import type { TaskType } from '@/domain/task';
import { initializeTutorRuntime } from '@/composition-root/public';
import { AgentRunAction, AgentRunType, type AgentRunAggregate } from '@/modules/agent/public';
import { projectRepository } from '@/services/ProjectRepository';
import type { JsonObject, JsonValue } from '@/kernel/public';
import { taskInputHash } from '@/tasks/TaskLocks';
import { taskQueue } from '@/tasks/TaskQueue';
import type { EnqueueResult } from '@/tasks/taskTypes';
import { profileGuardService } from './ProfileGuardService';

export type GenerationIntent = 'daily' | 'practice' | 'practiceGrade' | 'essayGrade' | 'mock' | 'redo' | 'digest' | 'monthlyDigest' | 'study' | 'interviewReview';

export interface GenerationTaskInput {
  intent: GenerationIntent;
  title?: string;
  detail?: string;
  module?: string;
  sourceId?: string;
  payload?: Record<string, unknown>;
}

const TASK_BY_INTENT: Record<GenerationIntent, TaskType> = {
  daily: 'digest',
  practice: 'generate',
  practiceGrade: 'grade',
  essayGrade: 'grade',
  mock: 'mock',
  redo: 'redo',
  digest: 'digest',
  monthlyDigest: 'digest',
  study: 'study',
  interviewReview: 'interview'
};

const TITLE_BY_INTENT: Record<GenerationIntent, string> = {
  daily: '每日积累',
  practice: '生成练习',
  practiceGrade: '行测错因分析',
  essayGrade: '申论批改',
  mock: '生成模考',
  redo: '错题重练',
  digest: '学习复盘',
  monthlyDigest: '时政月报',
  study: '考点精讲',
  interviewReview: '面试深度点评'
};

function lockKey(projectId: string, input: GenerationTaskInput): string {
  const stableSource = input.sourceId || input.module || input.intent;
  return `${input.intent}:${projectId}:${stableSource}`;
}

export class GenerationTaskService {
  async enqueue(input: GenerationTaskInput): Promise<EnqueueResult> {
    await profileGuardService.ensureActiveProfile(input.intent);
    const project = await projectRepository.getActiveProject();
    const agentRun = await this.startAgentRun(project.id, input);
    try {
      const result = await this.enqueueLegacy(project.id, input);
      if (agentRun) {
        const runtime = await initializeTutorRuntime();
        await runtime.transitionAgentRun.execute({
          idempotencyKey: `generation:${agentRun.run.id}:completed`,
          agentRunId: agentRun.run.id,
          action: AgentRunAction.Complete,
          reasonCode: 'generation_task.completed',
          checkpoint: { taskId: result.task.id, intent: input.intent, title: input.title || result.task.title },
          payload: { taskId: result.task.id, intent: input.intent, title: input.title || result.task.title, reused: result.reused }
        });
      }
      return result;
    } catch {
      if (agentRun) {
        try {
          const runtime = await initializeTutorRuntime();
          await runtime.transitionAgentRun.execute({
            idempotencyKey: `generation:${agentRun.run.id}:failed`,
            agentRunId: agentRun.run.id,
            action: AgentRunAction.Fail,
            reasonCode: 'generation_task.failed',
            errorCode: 'generation_task.enqueue_failed',
            payload: { intent: input.intent, title: input.title || TITLE_BY_INTENT[input.intent] }
          });
        } catch {
          // keep the original enqueue failure as the main signal
        }
      }
      return this.enqueueLegacy(project.id, input);
    }
  }

  async enqueueLegacy(projectId: string, input: GenerationTaskInput): Promise<EnqueueResult> {
    const taskType = TASK_BY_INTENT[input.intent];
    return taskQueue.enqueue({
      type: taskType,
      projectId,
      title: input.title || TITLE_BY_INTENT[input.intent],
      detail: input.detail || input.module || '准备执行',
      payload: {
        intent: input.intent,
        module: input.module,
        sourceId: input.sourceId,
        ...(input.payload || {})
      },
      inputHash: taskInputHash({
        intent: input.intent,
        module: input.module,
        sourceId: input.sourceId,
        payload: input.payload || {}
      }),
      lockKey: lockKey(projectId, input)
    });
  }

  private async startAgentRun(projectId: string, input: GenerationTaskInput): Promise<AgentRunAggregate | undefined> {
    try {
      const runtime = await initializeTutorRuntime();
      const created = await runtime.createAgentRun.execute({
        idempotencyKey: `generation:${projectId}:${input.intent}:${input.sourceId || input.module || input.title || 'task'}:${taskInputHash({
          intent: input.intent,
          title: input.title || '',
          detail: input.detail || '',
          module: input.module || '',
          sourceId: input.sourceId || '',
          payload: input.payload || {}
        })}`,
        runType: runTypeForIntent(input.intent),
        targetResourceType: 'generation_task',
        targetResourceId: input.sourceId || input.module || input.intent,
        inputSnapshot: {
          projectId,
          intent: input.intent,
          title: input.title || TITLE_BY_INTENT[input.intent],
          detail: input.detail || input.module || '准备执行',
          module: input.module ?? null,
          sourceId: input.sourceId ?? null,
          payload: toJsonObject(input.payload || {})
        }
      });
      if (created.run.status !== 'queued') return created;
      return runtime.transitionAgentRun.execute({
        idempotencyKey: `generation:${created.run.id}:started`,
        agentRunId: created.run.id,
        action: AgentRunAction.Start,
        reasonCode: 'generation_task.started',
        payload: {
          intent: input.intent,
          title: input.title || TITLE_BY_INTENT[input.intent]
        }
      });
    } catch {
      return undefined;
    }
  }
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]));
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (value && typeof value === 'object') return toJsonObject(value as Record<string, unknown>);
  return null;
}

export const generationTaskService = new GenerationTaskService();

function runTypeForIntent(intent: GenerationIntent): AgentRunType {
  if (intent === 'daily' || intent === 'monthlyDigest') return AgentRunType.TeachingPlan;
  if (intent === 'practiceGrade' || intent === 'essayGrade' || intent === 'interviewReview') return AgentRunType.TutorTurn;
  return AgentRunType.ContentGeneration;
}
