export interface AsyncMutexOptions {
  readonly waitTimeoutMs?: number;
  readonly timeoutMessage?: string;
  readonly timeoutError?: () => Error;
}

interface MutexWaiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  timer?: ReturnType<typeof globalThis.setTimeout>;
}

export class AsyncMutex {
  private locked = false;
  private readonly waiters: MutexWaiter[] = [];

  async runExclusive<T>(work: () => Promise<T>, options: AsyncMutexOptions = {}): Promise<T> {
    await this.acquire(options);
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(options: AsyncMutexOptions): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: MutexWaiter = { resolve, reject };
      const timeoutMs = options.waitTimeoutMs;
      if (timeoutMs !== undefined && timeoutMs > 0) {
        waiter.timer = globalThis.setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index < 0) return;
          this.waiters.splice(index, 1);
          reject(options.timeoutError?.() ?? new Error(options.timeoutMessage || 'Timed out waiting for exclusive access'));
        }, timeoutMs);
      }
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    const waiter = this.waiters.shift();
    if (!waiter) {
      this.locked = false;
      return;
    }
    if (waiter.timer !== undefined) globalThis.clearTimeout(waiter.timer);
    waiter.resolve();
  }
}
