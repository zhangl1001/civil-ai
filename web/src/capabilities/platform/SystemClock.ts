import type { Clock, DurationMs, InstantMs } from '@/kernel/public';

export class SystemClock implements Clock {
  now(): InstantMs {
    return Date.now() as InstantMs;
  }

  monotonicNowMs(): DurationMs {
    return performance.now() as DurationMs;
  }
}
