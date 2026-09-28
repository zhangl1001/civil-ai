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

/**
 * Outcome of an assistant turn that did not complete. Such rows stay visible
 * with their outcome but are never replayed to the model as something it said.
 */
export type ConversationMessageStatus = 'failed' | 'stopped';

export interface ConversationMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly role: ConversationRole;
  readonly content: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly status?: ConversationMessageStatus;
  /** Stable failure identity, e.g. `provider.authentication`. */
  readonly errorCode?: string;
  /** User-facing explanation recorded when the turn ended. */
  readonly errorMessage?: string;
  readonly createdAt: InstantMs;
}

export type ConversationMessageOutcome = Pick<ConversationMessage, 'status' | 'errorCode' | 'errorMessage'>;
