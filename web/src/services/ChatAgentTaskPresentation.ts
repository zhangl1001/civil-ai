import type { TutorDatabaseRuntime } from '@/composition-root/public';
import type { JsonObject } from '@/kernel/public';
import type { AgentRunAggregate } from '@/modules/agent/public';
import {
  MessageBusinessLine,
  MessageCategory,
  MessageEventCode,
  MessageSeverity,
  MessageSourceType
} from '@/modules/message-center/public';

export type ChatTaskOutcome = 'completed' | 'failed' | 'cancelled';

export function chatTaskPresentation(toolName?: string): JsonObject {
  if (!toolName?.startsWith('question_bank.')) return {};
  return {
    taskCenterVisible: true,
    taskCenterTitle: '真题导入',
    businessLine: 'practice',
    category: 'task',
    actionRoute: '/vue/practice',
    actionParams: { mode: 'true' }
  };
}

export async function publishChatTaskMessage(
  runtime: TutorDatabaseRuntime,
  aggregate: AgentRunAggregate,
  outcome: ChatTaskOutcome
): Promise<void> {
  if (aggregate.run.checkpoint.taskCenterVisible !== true) return;
  const toolName = String(aggregate.run.checkpoint.toolName || '');
  const eventCode = outcome === 'completed'
    ? MessageEventCode.TaskCompleted
    : outcome === 'failed'
      ? MessageEventCode.TaskFailed
      : MessageEventCode.TaskCancelled;
  const severity = outcome === 'completed'
    ? MessageSeverity.Success
    : outcome === 'failed'
      ? MessageSeverity.Error
      : MessageSeverity.Warning;
  const content = outcome === 'completed'
    ? completionText(toolName)
    : outcome === 'failed'
      ? '真题导入未完成，可返回对话查看失败步骤后重试。'
      : '本次真题导入已取消。';
  await runtime.messageCenter.publish({
    businessLine: MessageBusinessLine.Practice,
    category: MessageCategory.Task,
    eventCode,
    severity,
    title: '真题导入',
    content,
    sourceType: MessageSourceType.AgentRun,
    sourceId: aggregate.run.id,
    actionRoute: '/vue/practice',
    actionParams: { mode: 'true' },
    dedupKey: `chat-agent:${aggregate.run.id}:${eventCode}`
  }).catch(() => undefined);
}

function completionText(toolName: string): string {
  if (toolName === 'question_bank.publish') return '真题已经发布到题库，可进入真题练习查看。';
  if (toolName === 'question_bank.confirm') return '导入草稿已经确认，正式发布前仍需你的确认。';
  if (toolName === 'question_bank.scan') return '真题扫描草稿已经生成，请确认题目和来源后再发布。';
  return '本次真题导入处理已结束，可进入真题练习查看状态。';
}
