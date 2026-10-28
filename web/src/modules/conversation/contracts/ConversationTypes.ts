import type { InstantMs } from '@/kernel/public';
import type { AgentWorkflowInvocation } from '@/modules/agent/public';

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

/**
 * Chat rows the runtime wrote, not the model: a pending-confirmation prompt or
 * reminder, or the budget pause. They are shown like assistant bubbles but the
 * model must never read them as something it said.
 */
export type ConversationSystemNotice = 'confirmation' | 'budget_pause';

/** A write tool that really ran in the turn this row answers, for later context. */
export interface ConversationToolTrace {
  readonly toolName: string;
  /** Compact JSON of the call's arguments, clipped. */
  readonly arguments: string;
}

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
  /** Original request of this failed/stopped turn. Images remain ephemeral. */
  readonly retryRequest?: {
    readonly text: string;
    readonly invocation?: AgentWorkflowInvocation;
    readonly guidance: readonly string[];
  };
  readonly systemNotice?: ConversationSystemNotice;
  /** Successful write tools of the turn; absent on rows saved before traces existed. */
  readonly toolTrace?: readonly ConversationToolTrace[];
  readonly createdAt: InstantMs;
}

export type ConversationMessageOutcome = Pick<
  ConversationMessage,
  'status' | 'errorCode' | 'errorMessage' | 'retryRequest' | 'systemNotice' | 'toolTrace'
>;
