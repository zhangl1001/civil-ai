import type { ConversationMessageStatus } from '@/modules/conversation/public';
import type { AIChatMessage } from '@/services/AIChatRepository';
import { ChatFailureCode, chatFailureForCode, describeChatFailure } from '@/services/ChatAgentFailure';

export interface ChatMessageOutcome {
  readonly status: ConversationMessageStatus;
  readonly message: string;
  readonly configureModel: boolean;
}

export function compactGuidanceText(value: string): string {
  return value.length > 60 ? `${value.slice(0, 60)}...` : value;
}

export function chatErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/not implemented|unimplemented/i.test(message)) return '本地会话组件尚未加载，请重新运行最新版本。';
  const failure = describeChatFailure(error);
  if (failure.code !== ChatFailureCode.Unknown) return failure.message;
  return message.trim() || '操作没有完成，请重试。';
}

/** How an assistant turn that did not complete is shown, or nothing for a normal answer. */
export function chatMessageOutcome(message: AIChatMessage): ChatMessageOutcome | undefined {
  if (message.status === 'stopped') {
    return {
      status: 'stopped',
      message: message.errorMessage?.trim() || chatFailureForCode(message.errorCode || ChatFailureCode.Stopped).message,
      configureModel: false
    };
  }
  if (message.status !== 'failed') return undefined;
  const failure = chatFailureForCode(message.errorCode || ChatFailureCode.Unknown, message.errorMessage);
  return { status: 'failed', message: failure.message, configureModel: failure.configureModel };
}

export function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

export function clampChatSheetHeight(value: number): number {
  return Math.max(42, Math.min(92, value));
}
