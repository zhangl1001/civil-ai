import type { AgentRunId, InstantMs } from '@/kernel/public';
import type { AgentRunAggregate, AgentRunRepository } from '../contracts/AgentRunRepository';
import { AgentRunStatus, AgentRunType, type AgentRunStatus as AgentRunStatusValue, type AgentRunType as AgentRunTypeValue } from '../domain/AgentRunCodes';

export interface AgentRunView {
  readonly id: AgentRunId;
  readonly runType: AgentRunTypeValue;
  readonly status: AgentRunStatusValue;
  readonly title: string;
  readonly detail: string;
  readonly statusText: string;
  readonly targetResourceType?: string;
  readonly targetResourceId?: string;
  readonly linkedTaskId?: string;
  readonly toolName?: string;
  readonly chatSessionId?: string;
  readonly isActive: boolean;
  readonly canCancel: boolean;
  readonly eventCount: number;
  readonly invocationCount: number;
  readonly updatedAt: InstantMs;
  readonly createdAt: InstantMs;
}

export class GetAgentRunViews {
  constructor(private readonly repository: AgentRunRepository) {}

  async execute(command: { readonly limit: number }): Promise<readonly AgentRunView[]> {
    assertLimit(command.limit);
    const runs = await this.repository.listRecent(command.limit);
    return Promise.all(runs.map((run) => this.toView(run)));
  }

  private async toView(aggregate: AgentRunAggregate): Promise<AgentRunView> {
    const invocations = await this.repository.listInvocations(aggregate.run.id);
    return {
      id: aggregate.run.id,
      runType: aggregate.run.runType,
      status: aggregate.run.status,
      title: titleFor(aggregate),
      detail: detailFor(aggregate),
      statusText: statusText(aggregate.run.status),
      targetResourceType: aggregate.run.targetResourceType,
      targetResourceId: aggregate.run.targetResourceId,
      linkedTaskId: linkedTaskId(aggregate),
      toolName: textField(aggregate.run.inputSnapshot.toolName),
      chatSessionId: textField(aggregate.run.inputSnapshot.chatSessionId),
      isActive: isActive(aggregate.run.status),
      canCancel: canCancel(aggregate.run.status),
      eventCount: aggregate.events.length,
      invocationCount: invocations.length,
      updatedAt: aggregate.run.updatedAt,
      createdAt: aggregate.run.createdAt
    };
  }
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError('Agent run view limit must be between 1 and 50');
}

function titleFor(aggregate: AgentRunAggregate): string {
  if (aggregate.run.targetResourceType === 'chat_tool') return 'AI 工具执行';
  const type = aggregate.run.runType;
  if (type === AgentRunType.ErrorDiagnosis) return 'AI 错因分析';
  if (type === AgentRunType.ContentGeneration) return 'AI 内容生成';
  if (type === AgentRunType.TeachingPlan) return 'AI 教学计划';
  if (type === AgentRunType.Review) return 'AI 复习安排';
  return 'AI 私教对话';
}

function detailFor(aggregate: AgentRunAggregate): string {
  if (aggregate.run.errorCode) return aggregate.run.errorCode;
  if (aggregate.run.cancellationReason) return aggregate.run.cancellationReason;
  if (aggregate.run.targetResourceType === 'chat_tool') return chatToolDetail(aggregate);
  if (aggregate.run.targetResourceType) return [aggregate.run.targetResourceType, aggregate.run.targetResourceId].filter(Boolean).join(' · ');
  return aggregate.events.at(-1)?.reasonCode || '等待执行';
}

function chatToolDetail(aggregate: AgentRunAggregate): string {
  const toolName = textField(aggregate.run.inputSnapshot.toolName) || '';
  const args = isJsonObject(aggregate.run.inputSnapshot.arguments) ? aggregate.run.inputSnapshot.arguments : {};
  const taskId = linkedTaskId(aggregate);
  const detail = describeTool(toolName, args);
  return [detail, taskId ? `任务 ${taskId}` : ''].filter(Boolean).join(' · ');
}

function describeTool(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'generate_practice') return `生成${asText(args.module, '行测')}练习`;
  if (toolName === 'redo_wrongbook') return `错题重练 · ${asText(args.module, '默认模块')}`;
  if (toolName === 'generate_mock') return `生成行测模考`;
  if (toolName === 'generate_essay') return `生成${asText(args.essayTopic, '申论')}题`;
  if (toolName === 'generate_digest') return args.digestTab === 'tips' ? '生成每日知识点' : '生成每日热点';
  if (toolName === 'generate_monthly_digest') return '生成时政月报';
  if (toolName === 'grade_essay') return '申论批改入口';
  if (toolName === 'review_interview') return '面试点评入口';
  return toolName || '工具调用';
}

function asText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function linkedTaskId(aggregate: AgentRunAggregate): string | undefined {
  return textField(aggregate.run.checkpoint.taskId) || textField(aggregate.run.inputSnapshot.taskId);
}

function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function statusText(status: AgentRunStatusValue): string {
  if (status === AgentRunStatus.Queued) return '排队中';
  if (status === AgentRunStatus.Running) return '执行中';
  if (status === AgentRunStatus.WaitingUser) return '等待确认';
  if (status === AgentRunStatus.Completed) return '已完成';
  if (status === AgentRunStatus.Failed) return '失败';
  return '已取消';
}

function isActive(status: AgentRunStatusValue): boolean {
  return status === AgentRunStatus.Queued || status === AgentRunStatus.Running || status === AgentRunStatus.WaitingUser;
}

function canCancel(status: AgentRunStatusValue): boolean {
  return status === AgentRunStatus.Queued || status === AgentRunStatus.Running || status === AgentRunStatus.WaitingUser;
}
