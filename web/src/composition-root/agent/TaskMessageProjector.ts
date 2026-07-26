import type { JsonObject } from '@/kernel/public';
import type {
  AgentRunAggregate,
  AgentRunRepository,
  TutorAgentLifecycleObserver
} from '@/modules/agent/public';
import { AgentRunType, TaskTargetType } from '@/modules/agent/public';
import {
  MessageBusinessLine,
  MessageCategory,
  MessageEventCode,
  MessageSeverity,
  MessageSourceType,
  type MessageCenter
} from '@/modules/message-center/public';

/** Converts durable task lifecycle events into categorized user-facing messages. */
export class TaskMessageProjector implements TutorAgentLifecycleObserver {
  constructor(
    private readonly messages: MessageCenter,
    private readonly runs: AgentRunRepository
  ) {}

  queued(run: AgentRunAggregate): Promise<unknown> {
    if (!shouldProject(run)) return Promise.resolve();
    return this.messages.publish({
      businessLine: businessLine(run.run.inputSnapshot),
      category: MessageCategory.Task,
      eventCode: MessageEventCode.TaskQueued,
      severity: MessageSeverity.Info,
      title: title(run),
      content: detail(run, '任务已进入执行队列'),
      sourceType: MessageSourceType.AgentRun,
      sourceId: run.run.id,
      actionRoute: text(run.run.inputSnapshot.actionRoute),
      actionParams: object(run.run.inputSnapshot.actionParams),
      dedupKey: `agent-run:${run.run.id}:queued`
    });
  }

  completed(run: AgentRunAggregate): Promise<void> {
    return this.publishTerminal(run, MessageEventCode.TaskCompleted, MessageSeverity.Success, '任务已完成');
  }

  retrying(run: AgentRunAggregate): Promise<void> {
    return this.publishTerminal(run, MessageEventCode.TaskRetrying, MessageSeverity.Warning, '服务暂时繁忙，任务将自动重试');
  }

  failed(run: AgentRunAggregate): Promise<void> {
    return this.publishTerminal(run, MessageEventCode.TaskFailed, MessageSeverity.Error, '任务执行失败，可进入对应页面重试');
  }

  cancelled(run: AgentRunAggregate): Promise<void> {
    return this.publishTerminal(run, MessageEventCode.TaskCancelled, MessageSeverity.Warning, '任务已取消');
  }

  private async publishTerminal(
    run: AgentRunAggregate,
    eventCode: string,
    severity: typeof MessageSeverity[keyof typeof MessageSeverity],
    fallback: string
  ): Promise<void> {
    if (!shouldProject(run)) return;
    const current = await this.runs.findById(run.run.id) ?? run;
    await this.messages.publish({
      businessLine: businessLine(current.run.inputSnapshot),
      category: MessageCategory.Task,
      eventCode,
      severity,
      title: title(current),
      content: detail(current, fallback),
      sourceType: MessageSourceType.AgentRun,
      sourceId: current.run.id,
      actionRoute: text(current.run.checkpoint.actionRoute) || text(current.run.inputSnapshot.actionRoute),
      actionParams: object(current.run.checkpoint.actionParams, current.run.inputSnapshot.actionParams),
      dedupKey: `agent-run:${current.run.id}:${eventCode}`
    });
  }
}

function shouldProject(run: AgentRunAggregate): boolean {
  return run.run.targetResourceType !== TaskTargetType.ChatTool;
}

function businessLine(snapshot: JsonObject) {
  const value = text(snapshot.businessLine);
  return Object.values(MessageBusinessLine).includes(value as never)
    ? value as typeof MessageBusinessLine[keyof typeof MessageBusinessLine]
    : MessageBusinessLine.System;
}

function title(run: AgentRunAggregate): string {
  const explicit = text(run.run.inputSnapshot.title);
  if (explicit) return explicit;
  if (run.run.runType === AgentRunType.ErrorDiagnosis) return 'AI 错因分析';
  if (run.run.runType === AgentRunType.ContentGeneration) return 'AI 内容生成';
  if (run.run.runType === AgentRunType.TeachingPlan) return 'AI 教学计划';
  if (run.run.runType === AgentRunType.Review) return 'AI 复习安排';
  return 'AI 私教任务';
}

function detail(run: AgentRunAggregate, fallback: string): string {
  if (run.run.errorCode) return taskErrorText(run.run.errorCode);
  if (run.run.runType === AgentRunType.ErrorDiagnosis && fallback === '任务已完成') {
    const count = positiveInteger(run.run.inputSnapshot.diagnosisCount);
    return count
      ? `本组 ${count} 道错题已形成错因候选，可在题目解析下查看`
      : '已形成错因候选，可在题目解析下查看';
  }
  return text(run.run.checkpoint.message) || text(run.run.inputSnapshot.detail) || fallback;
}

function taskErrorText(code: string): string {
  if (code === 'agent.AbortError' || code === 'generation.process_interrupted') {
    return '模型连接意外中断，请重新执行任务';
  }
  if (code === 'agent.GeneratedContentParseError' || code.startsWith('generation.json')) {
    return '模型返回内容不完整，自动重试后仍无法解析';
  }
  if (code.includes('schema_invalid') || code === 'generation.questions_invalid') return '生成内容结构校验失败，请重新生成';
  if (code === 'generation.quality_invalid') return '生成内容结构不完整，请重新生成';
  if (code === 'generation.error_diagnosis_invalid') return '模型返回的错因结构不完整，请重新分析';
  if (code.startsWith('generation.')) return '生成内容校验失败，请重新生成';
  if (code === 'provider.authentication') return '模型配置认证失败，请检查 API Key';
  if (code === 'provider.invalid_request') return '当前模型接口不支持本次结构化请求，请检查供应商和模型配置';
  if (code === 'provider.rate_limited') return '模型服务限流，任务会自动重试';
  if (code === 'provider.empty_response') return '模型没有返回有效内容，请重新生成';
  if (code === 'provider.protocol') return '模型接口返回格式不兼容，请检查 Base URL';
  if (code === 'provider.transient') return '模型网络或服务暂时异常，请稍后重试';
  if (code.startsWith('provider.')) return '模型服务请求失败，请检查模型配置';
  return code;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function object(value: unknown, fallback?: unknown): JsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) {
    return value as JsonObject;
  }
  return fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback as JsonObject : {};
}
