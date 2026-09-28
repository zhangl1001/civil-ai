import type { AIMessage } from '@/domain/ai';

export const AI_CHAT_MESSAGE_PAGE_SIZE = 24;

export interface AIMessagePage<T extends AIMessage = AIMessage> {
  readonly messages: readonly T[];
  readonly hasMore: boolean;
}

export function paginateAIChatMessages<T extends AIMessage>(
  messages: readonly T[],
  beforeMessageId?: string,
  requestedLimit = AI_CHAT_MESSAGE_PAGE_SIZE
): AIMessagePage<T> {
  const limit = Math.max(1, Math.floor(requestedLimit));
  const cursorIndex = beforeMessageId
    ? messages.findIndex((message) => message.id === beforeMessageId)
    : messages.length;
  const end = cursorIndex >= 0 ? cursorIndex : messages.length;
  const start = Math.max(0, end - limit);
  return { messages: messages.slice(start, end), hasMore: start > 0 };
}
