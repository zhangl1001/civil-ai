import type { JsonObject } from '@/kernel/public';
import type {
  AgentRunAggregate,
  AgentRunRepository,
  TutorAgentLifecycleObserver
} from '@/modules/agent/public';
import {
  AgentRunNotificationMode,
  AgentRunType,
  TaskTargetType,
  agentRunFailureText,
  resolveAgentRunNotificationMode
} from '@/modules/agent/public';
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
    if (!shouldProject(run, 'lifecycle')) return Promise.resolve();
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
    return this.publish(run, 'terminal', MessageEventCode.TaskCompleted, MessageSeverity.Success, '任务已完成');
  }

  retrying(run: AgentRunAggregate): Promise<void> {
    return this.publish(run, 'lifecycle', MessageEventCode.TaskRetrying, MessageSeverity.Warning, '服务暂时繁忙，任务将自动重试');
  }

  failed(run: AgentRunAggregate): Promise<void> {
    return this.publish(run, 'terminal', MessageEventCode.TaskFailed, MessageSeverity.Error, '任务执行失败，可进入对应页面重试');
  }

  cancelled(run: AgentRunAggregate): Promise<void> {
    return this.publish(run, 'terminal', MessageEventCode.TaskCancelled, MessageSeverity.Warning, '任务已取消');
  }

  private async publish(
    run: AgentRunAggregate,
    phase: 'lifecycle' | 'terminal',
    eventCode: string,
    severity: typeof MessageSeverity[keyof typeof MessageSeverity],
    fallback: string
  ): Promise<void> {
    const current = await this.runs.findById(run.run.id) ?? run;
    if (!shouldProject(current, phase)) return;
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

function shouldProject(
  run: AgentRunAggregate,
  phase: 'lifecycle' | 'terminal'
): boolean {
  const notificationMode = resolveAgentRunNotificationMode(run.run.inputSnapshot);
  if (notificationMode === AgentRunNotificationMode.Silent) return false;
  if (
    notificationMode === AgentRunNotificationMode.Terminal
    && phase !== 'terminal'
  ) return false;
  const visibleAtTerminal = run.run.checkpoint.taskCenterVisible === true;
  if (!visibleAtTerminal && run.run.inputSnapshot.taskCenterVisible === false) return false;
  return visibleAtTerminal || run.run.targetResourceType !== TaskTargetType.ChatTool;
}

function businessLine(snapshot: JsonObject) {
  const value = text(snapshot.businessLine);
  return Object.values(MessageBusinessLine).includes(value as never)
    ? value as typeof MessageBusinessLine[keyof typeof MessageBusinessLine]
    : MessageBusinessLine.System;
}

function title(run: AgentRunAggregate): string {
  const taskCenterTitle = text(run.run.checkpoint.taskCenterTitle);
  if (taskCenterTitle) return taskCenterTitle;
  const explicit = text(run.run.inputSnapshot.title);
  if (explicit) return explicit;
  if (run.run.runType === AgentRunType.ErrorDiagnosis) return 'AI 错因分析';
  if (run.run.runType === AgentRunType.ContentGeneration) return 'AI 内容生成';
  if (run.run.runType === AgentRunType.TeachingPlan) return 'AI 教学计划';
  if (run.run.runType === AgentRunType.Review) return 'AI 复习安排';
  return 'AI 私教任务';
}

function detail(run: AgentRunAggregate, fallback: string): string {
  if (run.run.errorCode) {
    return agentRunFailureText(
      run.run.errorCode,
      text(run.run.checkpoint.errorMessage) || text(run.run.checkpoint.message)
    );
  }
  if (run.run.runType === AgentRunType.ErrorDiagnosis && fallback === '任务已完成') {
    const count = positiveInteger(run.run.inputSnapshot.diagnosisCount);
    return count
      ? `本组 ${count} 道错题已形成错因候选，可在题目解析下查看`
      : '已形成错因候选，可在题目解析下查看';
  }
  return text(run.run.checkpoint.message) || text(run.run.inputSnapshot.detail) || fallback;
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
