import type { ConversationMessageOutcome } from '@/modules/conversation/public';
import type { AIChatMessage, AIChatRepository } from './AIChatRepository';
import { hasVisibleAssistantContent, visibleAssistantText } from './AgentResponsePresentation';
import type { ChatFailure } from './ChatAgentFailure';

export interface ChatAssistantStreamUpdate extends ConversationMessageOutcome {
  readonly sessionId: string;
  readonly messageId: string;
  readonly content: string;
  readonly replaceMessageId?: string;
  /** Text of a model turn that went on to call tools; the answer is still coming. */
  readonly provisional?: boolean;
}

export type ChatTurnRepository = Pick<AIChatRepository, 'addMessage' | 'updateMessageMeta'>;

export interface ChatAgentTurnWriterOptions {
  readonly sessionId: string;
  /** Temporary id of the bubble that shows streamed text before it is persisted. */
  readonly streamMessageId: string;
  readonly repository: ChatTurnRepository;
  readonly publish?: (update: ChatAssistantStreamUpdate) => void | Promise<void>;
  /** Streamed text reaches the UI at most once per interval (the first delta at once). */
  readonly publishIntervalMs?: number;
  readonly now?: () => number;
}

/**
 * Owns the assistant side of one chat turn: what is shown while the model
 * streams, and the single row that is persisted when the turn ends — the
 * answer, or the partial text together with why the turn did not finish.
 *
 * Only the latest model turn is on screen. Text of a turn that went on to call
 * tools stays visible as provisional until the next turn starts writing, so
 * successive turns are never glued into one Markdown document.
 */
export class ChatAgentTurnWriter {
  private turnText = '';
  /** Text of the next turn, held back until it has something to show. */
  private nextTurnText = '';
  private provisional = false;
  private replaceOnNextDelta = false;
  private streamPublished = false;
  private dirty = false;
  private settled = false;
  private lastPublishedAt = Number.NEGATIVE_INFINITY;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private persistedMessageId = '';
  private persistedContent = '';
  private completed = false;
  private finished = false;
  private runId?: string;
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(private readonly options: ChatAgentTurnWriterOptions) {
    this.intervalMs = options.publishIntervalMs ?? 80;
    this.now = options.now ?? (() => Date.now());
  }

  /** Links the persisted answer to its Agent run. */
  bindRun(runId: string): void {
    this.runId = runId;
  }

  /** True once the final answer of the run has been saved. */
  get hasCompletedAnswer(): boolean {
    return this.completed;
  }

  /** True once the turn ended with an answer, a failure or a stop. */
  get isFinished(): boolean {
    return this.finished;
  }

  /** The text currently on screen, provisional or not. */
  get visibleText(): string {
    const visible = visibleAssistantText(this.turnText);
    return hasVisibleAssistantContent(visible) ? visible : '';
  }

  /** A new model turn begins; whatever is on screen belongs to an earlier turn. */
  startTurn(): void {
    if (!this.turnText) return;
    this.replaceOnNextDelta = true;
    this.nextTurnText = '';
    this.markProvisional();
  }

  /** The current turn asked for tools, so its text was a preamble, not the answer. */
  markToolCall(): void {
    if (this.turnText) this.markProvisional();
  }

  appendDelta(delta: string): void {
    if (!delta || this.settled) return;
    if (this.replaceOnNextDelta) {
      // Keep the provisional preamble on screen until the next turn has
      // visible text; a leading "#" or "<think>" alone would blank the bubble.
      this.nextTurnText += delta;
      if (!hasVisibleAssistantContent(visibleAssistantText(this.nextTurnText))) return;
      this.turnText = this.nextTurnText;
      this.nextTurnText = '';
      this.replaceOnNextDelta = false;
      this.provisional = false;
    } else {
      this.turnText += delta;
    }
    this.schedule(false);
  }

  /** Keeps text the user saw before the run paused (confirmation or budget). */
  async persist(content: string, marks: Pick<ConversationMessageOutcome, 'systemNotice' | 'toolTrace'> = {}): Promise<AIChatMessage | undefined> {
    if (!content.trim()) return undefined;
    return this.write(content, marks);
  }

  /**
   * Saves the final answer, replacing the streaming bubble. `systemNotice` marks
   * text the runtime wrote; `toolTrace` records writes that really ran.
   */
  async complete(content: string, marks: Pick<ConversationMessageOutcome, 'systemNotice' | 'toolTrace'> = {}): Promise<AIChatMessage | undefined> {
    const message = await this.persist(content, marks);
    this.completed = true;
    this.finished = true;
    return message;
  }

  /** Records a turn that failed, keeping whatever answer text was already visible. */
  async fail(failure: ChatFailure): Promise<AIChatMessage | undefined> {
    return this.finish('failed', failure);
  }

  /**
   * Records a turn the user stopped (or the app interrupted): the text that
   * was on screen stays, marked as stopped, and survives a reload.
   */
  async stop(reason: ChatFailure): Promise<AIChatMessage | undefined> {
    return this.finish('stopped', reason);
  }

  private async finish(
    status: 'failed' | 'stopped',
    reason: ChatFailure
  ): Promise<AIChatMessage | undefined> {
    const message = await this.write(this.visibleText, {
      status,
      errorCode: reason.code,
      errorMessage: reason.message
    });
    this.finished = true;
    return message;
  }

  /** Stops streaming updates; a late timer must not resurrect the stream bubble. */
  dispose(): void {
    this.settled = true;
    this.cancelFlush();
  }

  private markProvisional(): void {
    if (this.provisional) return;
    this.provisional = true;
    this.schedule(true);
  }

  private schedule(immediate: boolean): void {
    if (this.settled) return;
    this.dirty = true;
    if (this.flushTimer && !immediate) return;
    this.cancelFlush();
    const wait = immediate ? 0 : this.lastPublishedAt + this.intervalMs - this.now();
    if (wait <= 0) {
      this.flush();
      return;
    }
    this.flushTimer = globalThis.setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, wait);
  }

  private flush(): void {
    if (!this.dirty || this.settled) return;
    this.dirty = false;
    const visible = this.visibleText;
    if (!visible && !this.streamPublished) return;
    this.streamPublished = true;
    this.lastPublishedAt = this.now();
    void Promise.resolve(this.publish(this.options.streamMessageId, visible, undefined, {}, this.provisional))
      .catch((error: unknown) => console.warn('[ChatAgent] stream update was not shown', error));
  }

  private cancelFlush(): void {
    if (!this.flushTimer) return;
    globalThis.clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
  }

  private async write(content: string, outcome: ConversationMessageOutcome): Promise<AIChatMessage | undefined> {
    this.dispose();
    if (this.persistedMessageId) {
      if (content === this.persistedContent && !outcome.status && !outcome.toolTrace?.length && !outcome.systemNotice) return undefined;
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
    outcome: ConversationMessageOutcome = {},
    provisional = false
  ): Promise<void> {
    await this.options.publish?.({
      sessionId: this.options.sessionId,
      messageId,
      content,
      ...(replaceMessageId ? { replaceMessageId } : {}),
      ...(provisional ? { provisional } : {}),
      ...(outcome.status ? { status: outcome.status } : {}),
      ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
      ...(outcome.errorMessage ? { errorMessage: outcome.errorMessage } : {})
    });
  }
}
