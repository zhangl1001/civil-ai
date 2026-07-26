import type { ModelToolCall } from '@/capabilities/ai-runtime/public';
import type { AgentRunId, JsonObject } from '@/kernel/public';

export type AgentToolActivityStatus = 'queued' | 'running' | 'waiting_user' | 'completed' | 'failed';

export interface AgentToolActivity {
  readonly chatSessionId: string;
  readonly agentRunId: AgentRunId;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly label: string;
  readonly argumentSummary: string;
  readonly status: AgentToolActivityStatus;
  readonly statusText: string;
  readonly resultRef?: string;
  readonly reasonCode?: string;
  readonly updatedAt: number;
}

interface AgentToolActivityUpdate {
  readonly chatSessionId: string;
  readonly agentRunId: AgentRunId;
  readonly call: ModelToolCall;
  readonly label: string;
  readonly status: AgentToolActivityStatus;
  readonly resultRef?: string;
  readonly reasonCode?: string;
}

type ActivityListener = (activity?: AgentToolActivity) => void;

/** Ephemeral UI telemetry. It is intentionally never written to SQLite or IndexedDB. */
export class AgentToolActivityService {
  private currentRunId?: AgentRunId;
  private currentSessionId?: string;
  private readonly currentRunActivities = new Map<string, AgentToolActivity>();
  private readonly listeners = new Set<ActivityListener>();

  record(update: AgentToolActivityUpdate): AgentToolActivity {
    if (this.currentRunId !== update.agentRunId) {
      this.currentRunId = update.agentRunId;
      this.currentSessionId = update.chatSessionId;
      this.currentRunActivities.clear();
    }
    const latestTimestamp = Math.max(0, ...[...this.currentRunActivities.values()].map((item) => item.updatedAt));
    const activity: AgentToolActivity = {
      chatSessionId: update.chatSessionId,
      agentRunId: update.agentRunId,
      toolCallId: update.call.id,
      toolName: update.call.name,
      label: update.label,
      argumentSummary: summarizeArguments(update.call.arguments),
      status: update.status,
      statusText: statusText(update.status),
      resultRef: update.resultRef,
      reasonCode: update.reasonCode,
      updatedAt: Math.max(Date.now(), latestTimestamp + 1)
    };
    this.currentRunActivities.set(activity.toolCallId, activity);
    this.listeners.forEach((listener) => listener(activity));
    return activity;
  }

  list(chatSessionId: string): readonly AgentToolActivity[] {
    if (this.currentSessionId !== chatSessionId) return [];
    return [...this.currentRunActivities.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 8);
  }

  clear(chatSessionId: string): void {
    if (this.currentSessionId !== chatSessionId) return;
    this.currentRunId = undefined;
    this.currentSessionId = undefined;
    this.currentRunActivities.clear();
  }

  subscribe(listener: ActivityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function summarizeArguments(argumentsValue: JsonObject): string {
  const parts = Object.entries(argumentsValue).flatMap(([key, value]) => {
    if (/api.?key|token|secret|password|content|base64/i.test(key)) return [];
    const text = argumentValueText(value);
    return text ? [`${argumentLabel(key)}: ${text}`] : [];
  });
  return parts.length ? parts.slice(0, 3).join(' · ') : '无参数';
}

function argumentValueText(value: unknown): string {
  if (typeof value === 'string') return compactText(value.replace(/\s+/g, ' '));
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.slice(0, 3).map(argumentValueText).filter(Boolean).join('、');
  return '';
}

function argumentLabel(key: string): string {
  return ({
    path: '文件',
    module: '模块',
    knowledgePoint: '考点',
    questionCount: '题量',
    difficulty: '难度',
    digestTab: '类型',
    essayTopic: '主题',
    targetScore: '目标分',
    subject: '科目'
  } as Record<string, string>)[key] || key;
}

function statusText(status: AgentToolActivityStatus): string {
  if (status === 'queued') return '准备中';
  if (status === 'running') return '执行中';
  if (status === 'waiting_user') return '等待确认';
  if (status === 'completed') return '已完成';
  return '失败';
}

function compactText(value: string): string {
  return value.length > 96 ? `${value.slice(0, 96)}...` : value;
}

export const agentToolActivityService = new AgentToolActivityService();
