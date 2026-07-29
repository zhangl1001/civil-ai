import {
  ProviderErrorKind,
  ProviderGatewayError
} from '@/capabilities/ai-runtime/public';

type ScheduledWork<T> = () => Promise<T>;

interface QueueEntry<T> {
  readonly work: ScheduledWork<T>;
  readonly signal?: AbortSignal;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

/**
 * Bounds model pressure across all question-generation workflows in this WebView.
 * Per-workflow parallelism is handled by the caller; this gate prevents several
 * concurrent Agent tasks from multiplying into an unsafe number of provider calls.
 */
export class GenerationRequestScheduler {
  private active = 0;
  private activeLimit: number;
  private readonly configuredLimit: number;
  private successesSinceBackpressure = 0;
  private readonly queue: QueueEntry<unknown>[] = [];

  constructor(configuredLimit = 6) {
    this.configuredLimit = boundedLimit(configuredLimit);
    this.activeLimit = this.configuredLimit;
  }

  run<T>(work: ScheduledWork<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        work,
        signal,
        resolve: resolve as (value: unknown) => void,
        reject
      });
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.activeLimit && this.queue.length) {
      const entry = this.queue.shift()!;
      if (entry.signal?.aborted) {
        entry.reject(entry.signal.reason);
        continue;
      }
      this.active += 1;
      void entry.work()
        .then((value) => {
          this.recordSuccess();
          entry.resolve(value);
        })
        .catch((error: unknown) => {
          if (isBackpressure(error)) this.recordBackpressure();
          entry.reject(error);
        })
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }

  private recordBackpressure(): void {
    this.activeLimit = Math.max(1, this.activeLimit - 1);
    this.successesSinceBackpressure = 0;
  }

  private recordSuccess(): void {
    if (this.activeLimit >= this.configuredLimit) return;
    this.successesSinceBackpressure += 1;
    if (this.successesSinceBackpressure < this.activeLimit * 3) return;
    this.activeLimit += 1;
    this.successesSinceBackpressure = 0;
  }
}

function boundedLimit(value: number): number {
  if (!Number.isFinite(value)) return 6;
  return Math.max(1, Math.min(8, Math.floor(value)));
}

function isBackpressure(error: unknown): boolean {
  return error instanceof ProviderGatewayError
    && (
      error.kind === ProviderErrorKind.RateLimited
      || error.kind === ProviderErrorKind.Transient
    );
}

export const generationRequestScheduler = new GenerationRequestScheduler(6);
