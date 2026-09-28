import type { ConversationMessageOutcome } from '@/modules/conversation/public';
import type { AIChatMessage, AIChatRepository } from './AIChatRepository';
import { hasVisibleAssistantContent, visibleAssistantText } from './AgentResponsePresentation';
import type { ChatFailure } from './ChatAgentFailure';

export interface ChatAssistantStreamUpdate extends ConversationMessageOutcome {
  readonly sessionId: string;
  readonly messageId: string;
  readonly content: string;
  readonly replaceMessageId?: string;
}

export type ChatTurnRepository = Pick<AIChatRepository, 'addMessage' | 'updateMessageMeta'>;

export interface ChatAgentTurnWriterOptions {
  readonly sessionId: string;
  /** Temporary id of the bubble that shows streamed text before it is persisted. */
  readonly streamMessageId: string;
  readonly repository: ChatTurnRepository;
  readonly publish?: (update: ChatAssistantStreamUpdate) => void | Promise<void>;
}

/**
 * Owns the assistant side of one chat turn: what is shown while the model
 * streams, and the single row that is persisted when the turn ends — the
 * answer, or the partial text together with why the turn did not finish.
 */
export class ChatAgentTurnWriter {
  private streamedText = '';
  private streamPublished = false;
  private persistedMessageId = '';
  private persistedContent = '';
  private completed = false;
  private runId?: string;

  constructor(private readonly options: ChatAgentTurnWriterOptions) {}

  /** Links the persisted answer to its Agent run. */
  bindRun(runId: string): void {
    this.runId = runId;
  }

  /** True once the final answer of the run has been saved. */
  get hasCompletedAnswer(): boolean {
    return this.completed;
  }

  get visibleText(): string {
    const visible = visibleAssistantText(this.streamedText);
    return hasVisibleAssistantContent(visible) ? visible : '';
  }

  async appendDelta(delta: string): Promise<void> {
    if (!delta) return;
    this.streamedText += delta;
    const visible = this.visibleText;
    if (!visible) return;
    this.streamPublished = true;
    await this.publish(this.options.streamMessageId, visible);
  }

  /** Keeps text the user saw before the run paused (confirmation or budget). */
  async persist(content: string): Promise<AIChatMessage | undefined> {
    if (!content.trim()) return undefined;
    return this.write(content, {});
  }

  /** Saves the final answer, replacing the streaming bubble. */
  async complete(content: string): Promise<AIChatMessage | undefined> {
    const message = await this.persist(content);
    this.completed = true;
    return message;
  }

  /** Records a turn that failed, keeping whatever answer text was already visible. */
  async fail(failure: ChatFailure): Promise<AIChatMessage | undefined> {
    return this.write(this.visibleText, {
      status: 'failed',
      errorCode: failure.code,
      errorMessage: failure.message
    });
  }

  private async write(content: string, outcome: ConversationMessageOutcome): Promise<AIChatMessage | undefined> {
    if (this.persistedMessageId) {
      if (content === this.persistedContent && !outcome.status) return undefined;
      const message = await this.options.repository.updateMessageMeta(
        this.options.sessionId,
        this.persistedMessageId,
        { content, ...outcome }
      );
      this.persistedContent = content;
      if (message) await this.publish(message.id, message.content, undefined, message);
      return message;
    }
    const message = await this.options.repository.addMessage({
      sessionId: this.options.sessionId,
      role: 'assistant',
      content,
      ...(this.runId ? { toolCallId: this.runId } : {}),
      ...outcome
    });
    this.persistedMessageId = message.id;
    this.persistedContent = message.content;
    await this.publish(
      message.id,
      message.content,
      this.streamPublished ? this.options.streamMessageId : undefined,
      message
    );
    return message;
  }

  private async publish(
    messageId: string,
    content: string,
    replaceMessageId?: string,
    outcome: ConversationMessageOutcome = {}
  ): Promise<void> {
    await this.options.publish?.({
      sessionId: this.options.sessionId,
      messageId,
      content,
      ...(replaceMessageId ? { replaceMessageId } : {}),
      ...(outcome.status ? { status: outcome.status } : {}),
      ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
      ...(outcome.errorMessage ? { errorMessage: outcome.errorMessage } : {})
    });
  }
}
