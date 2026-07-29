import type { InstantMs } from '@/kernel/public';

export type ConversationRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ConversationSession {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly summary?: string;
  readonly summaryUpdatedAt?: InstantMs;
  readonly summaryCursorMessageId?: string;
  readonly summaryVersion?: number;
  readonly createdAt: InstantMs;
  readonly updatedAt: InstantMs;
}

export interface ConversationMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly role: ConversationRole;
  readonly content: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly createdAt: InstantMs;
}
