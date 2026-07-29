import type { AgentRunId, InstantMs, JsonObject } from '@/kernel/public';
import type { AgentRunAggregate, AgentRunRepository } from '../contracts/AgentRunRepository';
import { AgentRunStatus, AgentRunType, type AgentRunStatus as AgentRunStatusValue, type AgentRunType as AgentRunTypeValue } from '../domain/AgentRunCodes';
import { invalidProviderRequestText } from './AgentRunErrorPresentation';

export interface AgentRunView {
  readonly id: AgentRunId;
  readonly runType: AgentRunTypeValue;
  readonly status: AgentRunStatusValue;
  readonly examCycleId?: string;
  readonly intent?: string;
  readonly title: string;
  readonly detail: string;
  readonly statusText: string;
  readonly progress: number;
  readonly step?: string;
  readonly message?: string;
  readonly businessLine?: string;
  readonly category?: string;
  readonly scopeKey?: string;
  readonly actionRoute?: string;
  readonly actionParams: JsonObject;
  readonly questionSetId?: string;
  readonly learningThreadId?: string;
  readonly dailyPlanItemId?: string;
  readonly reviewQueueItemId?: string;
  readonly targetResourceType?: string;
  readonly targetResourceId?: string;
  readonly linkedTaskId?: string;
  readonly toolName?: string;
  readonly chatSessionId?: string;
  readonly taskCenterVisible: boolean;
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
    const counts = await this.repository.countInvocations(runs.map((run) => run.run.id));
    return runs.map((run) => this.toView(run, counts[run.run.id] ?? 0));
  }

  async findById(id: AgentRunId): Promise<AgentRunView | undefined> {
    const aggregate = await this.repository.findById(id);
    return aggregate ? this.toView(aggregate, (await this.repository.listInvocations(id)).length) : undefined;
  }

  async findLatestByTarget(targetResourceType: string, targetResourceId: string): Promise<AgentRunView | undefined> {
    const aggregate = await this.repository.findLatestByTarget(targetResourceType, targetResourceId);
    return aggregate ? this.toView(
      aggregate,
      (await this.repository.listInvocations(aggregate.run.id)).length
    ) : undefined;
  }

  async findActiveByTarget(targetResourceType: string, targetResourceId: string): Promise<AgentRunView | undefined> {
    const aggregate = await this.repository.findActiveByTarget(targetResourceType, targetResourceId);
    return aggregate ? this.toView(
      aggregate,
      (await this.repository.listInvocations(aggregate.run.id)).length
    ) : undefined;
  }

  private toView(aggregate: AgentRunAggregate, invocationCount: number): AgentRunView {
    const terminalVisibility = aggregate.run.checkpoint.taskCenterVisible === true;
    return {
      id: aggregate.run.id,
      runType: aggregate.run.runType,
      status: aggregate.run.status,
      examCycleId: aggregate.run.examCycleId,
      intent: textField(aggregate.run.inputSnapshot.intent),
      title: titleFor(aggregate),
      detail: detailFor(aggregate),
      statusText: statusText(aggregate.run.status),
      progress: progressFor(aggregate),
      step: textField(aggregate.run.checkpoint.step),
      message: textField(aggregate.run.checkpoint.message),
      businessLine: textField(aggregate.run.inputSnapshot.businessLine),
      category: textField(aggregate.run.inputSnapshot.category),
      scopeKey: textField(aggregate.run.inputSnapshot.scopeKey),
      actionRoute: textField(aggregate.run.checkpoint.actionRoute) || textField(aggregate.run.inputSnapshot.actionRoute),
      actionParams: objectField(aggregate.run.checkpoint.actionParams) || objectField(aggregate.run.inputSnapshot.actionParams) || {},
      questionSetId: textField(aggregate.run.checkpoint.questionSetId),
      learningThreadId: textField(aggregate.run.checkpoint.learningThreadId) || aggregate.run.learningThreadId,
      dailyPlanItemId: textField(aggregate.run.checkpoint.dailyPlanItemId) || textField(aggregate.run.inputSnapshot.dailyPlanItemId),
      reviewQueueItemId: textField(aggregate.run.checkpoint.reviewQueueItemId) || textField(aggregate.run.inputSnapshot.reviewQueueItemId),
      targetResourceType: aggregate.run.targetResourceType,
      targetResourceId: aggregate.run.targetResourceId,
      linkedTaskId: linkedTaskId(aggregate),
      toolName: textField(aggregate.run.checkpoint.toolName) || textField(aggregate.run.inputSnapshot.toolName),
      chatSessionId: textField(aggregate.run.inputSnapshot.chatSessionId),
      taskCenterVisible: (
        terminalVisibility
        || (
          aggregate.run.inputSnapshot.taskCenterVisible !== false
          && (
            aggregate.run.targetResourceType !== 'chat_tool'
            || terminalVisibility
          )
        )
      ),
      isActive: isActive(aggregate.run.status),
      canCancel: canCancel(aggregate.run.status),
      eventCount: aggregate.events.length,
      invocationCount,
      updatedAt: aggregate.run.updatedAt,
      createdAt: aggregate.run.createdAt
    };
  }
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError('Agent run view limit must be between 1 and 50');
}

function titleFor(aggregate: AgentRunAggregate): string {
  const taskCenterTitle = textField(aggregate.run.checkpoint.taskCenterTitle);
  if (taskCenterTitle) return taskCenterTitle;
  const explicit = textField(aggregate.run.inputSnapshot.title);
  if (explicit) return explicit;
  if (aggregate.run.targetResourceType === 'chat_tool') return 'AI 工具执行';
  const type = aggregate.run.runType;
  if (type === AgentRunType.ErrorDiagnosis) return 'AI 错因分析';
  if (type === AgentRunType.ContentGeneration) return 'AI 内容生成';
  if (type === AgentRunType.TeachingPlan) return 'AI 教学计划';
  if (type === AgentRunType.Review) return 'AI 复习安排';
  return 'AI 私教对话';
}

function detailFor(aggregate: AgentRunAggregate): string {
  if (aggregate.run.errorCode) {
    return taskErrorText(
      aggregate.run.errorCode,
      textField(aggregate.run.checkpoint.errorMessage) || textField(aggregate.run.checkpoint.message)
    );
  }
  if (aggregate.run.cancellationReason) return aggregate.run.cancellationReason;
  if (
    aggregate.run.runType === AgentRunType.ErrorDiagnosis
    && (aggregate.run.status === AgentRunStatus.Completed || aggregate.run.status === AgentRunStatus.Cancelled)
  ) {
    return errorDiagnosisDetail(aggregate);
  }
  const progressMessage = textField(aggregate.run.checkpoint.message);
  if (progressMessage) return progressMessage;
  const explicit = textField(aggregate.run.inputSnapshot.detail);
  if (explicit) return explicit;
  if (aggregate.run.targetResourceType === 'chat_tool') return chatToolDetail(aggregate);
  if (aggregate.run.runType === AgentRunType.ErrorDiagnosis) return errorDiagnosisDetail(aggregate);
  if (aggregate.run.targetResourceType) return [aggregate.run.targetResourceType, aggregate.run.targetResourceId].filter(Boolean).join(' · ');
  return aggregate.events.at(-1)?.reasonCode || '等待执行';
}

function errorDiagnosisDetail(aggregate: AgentRunAggregate): string {
  const count = numberField(aggregate.run.inputSnapshot.diagnosisCount);
  if (aggregate.run.status === AgentRunStatus.Queued) {
    return count ? `等待分析本组 ${count} 道错题` : '等待分析本题错因';
  }
  if (aggregate.run.status === AgentRunStatus.Running) {
    return count ? `正在分析本组 ${count} 道错题` : '正在结合题目、选项和作答记录分析';
  }
  if (aggregate.run.status === AgentRunStatus.Completed) {
    return count ? `本组 ${count} 道错题已形成错因候选，可在题目解析下查看` : '已形成错因候选，可在题目解析下查看';
  }
  if (aggregate.run.status === AgentRunStatus.Cancelled) return '本次错因分析已取消';
  return '错因分析等待恢复';
}

function taskErrorText(code: string, diagnostic?: string): string {
  if (code === 'agent.AbortError') return '模型连接意外中断，请重新执行任务';
  if (
    code === 'agent.GeneratedContentParseError'
    || code === 'generation.json_invalid'
    || code === 'generation.json_fence_invalid'
  ) {
    return '模型返回内容不完整，自动重试后仍无法解析';
  }
  if (code === 'generation.lecture_schema_invalid') return '讲义结构校验失败，请重新生成';
  if (code === 'generation.question_schema_invalid' || code === 'generation.questions_invalid') {
    return '题目结构校验失败，请重新生成';
  }
  if (code === 'generation.quality_invalid') return '题目结构不完整，请重新生成';
  if (code === 'generation.error_diagnosis_invalid') return '模型返回的错因结构不完整，请重新分析';
  if (code.startsWith('generation.')) return '生成内容校验失败，请重新生成';
  if (code === 'provider.authentication') return '模型配置认证失败，请检查 API Key';
  if (code === 'provider.invalid_request') return invalidProviderRequestText(diagnostic);
  if (code === 'provider.rate_limited') return '模型服务限流，任务会自动重试';
  if (code === 'provider.empty_response') return '模型没有返回有效内容，请重新生成';
  if (code === 'provider.protocol') return '模型接口返回格式不兼容，请检查 Base URL';
  if (code === 'provider.transient') return '模型网络或服务暂时异常，请稍后重试';
  if (code.startsWith('provider.')) return '模型服务请求失败，请检查模型配置';
  if (diagnostic && !/^agent\.(error|Error|unknown_error)$/.test(code)) return diagnostic;
  return diagnostic || '任务执行失败，请重新生成';
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
  if (toolName === 'research_true_questions') return `联网真题研究 · ${asText(args.scope, '当前备考范围')}`;
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

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function objectField(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.keys(value).length ? value as JsonObject : undefined;
}

function progressFor(aggregate: AgentRunAggregate): number {
  const value = aggregate.run.checkpoint.progress;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)));
  if (aggregate.run.status === AgentRunStatus.Completed) return 100;
  return aggregate.run.status === AgentRunStatus.Running ? 5 : 0;
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
