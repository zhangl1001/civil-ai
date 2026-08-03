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
  private lastBackpressureAt = Number.NEGATIVE_INFINITY;
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
    const now = Date.now();
    // Several shards or retries can observe the same provider throttle. Treat
    // them as one pressure event; otherwise a single incident permanently
    // collapses six-way generation to one-way execution.
    if (now - this.lastBackpressureAt < 5_000) return;
    this.lastBackpressureAt = now;
    this.activeLimit = Math.max(1, this.activeLimit - 1);
    this.successesSinceBackpressure = 0;
  }

  private recordSuccess(): void {
    if (this.activeLimit >= this.configuredLimit) return;
    this.successesSinceBackpressure += 1;
    // One clean wave is enough evidence to cautiously restore one slot.
    if (this.successesSinceBackpressure < this.activeLimit) return;
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

// Six short calls let a normal 25-question set (five shards plus its lecture)
// finish in one provider wave. The adaptive limiter still backs off on actual
// rate-limit/transient responses instead of permanently serializing every user.
export const generationRequestScheduler = new GenerationRequestScheduler(6);
