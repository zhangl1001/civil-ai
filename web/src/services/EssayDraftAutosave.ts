import type { EssayContext } from './EssayFlowService';

export type EssayDraftWriter = (draft: string, context: EssayContext) => Promise<void>;

interface PendingDraft {
  readonly draft: string;
  readonly context: EssayContext;
}

/**
 * Long-form answering types thousands of characters; persisting on every keystroke would
 * put the database in the input path. Writes are coalesced and kept strictly in order so
 * the last keystroke always wins.
 */
export class EssayDraftAutosave {
  /** Inferred so the debounce works under both the DOM and Node timer typings. */
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private pending: PendingDraft | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly write: EssayDraftWriter,
    private readonly delayMs = 180,
    private readonly onError: (cause: unknown) => void = () => undefined
  ) {}

  schedule(draft: string, context: EssayContext): void {
    this.pending = { draft, context };
    if (this.timerId !== null) clearTimeout(this.timerId);
    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.enqueuePending();
    }, this.delayMs);
  }

  /** Persists any coalesced draft right away and resolves once it has landed. */
  flush(): Promise<void> {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.enqueuePending();
    return this.queue;
  }

  /** Drops a scheduled write, for when the draft is being replaced from storage anyway. */
  cancel(): void {
    if (this.timerId !== null) clearTimeout(this.timerId);
    this.timerId = null;
    this.pending = null;
  }

  private enqueuePending(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.queue = this.queue
      .then(() => this.write(pending.draft, pending.context))
      .catch((cause) => this.onError(cause));
  }
}
