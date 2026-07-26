import { DEFAULT_MAX_CONCURRENT_AGENT_RUNS } from './AgentRunCodes';

/**
 * Keeps the user-selected ceiling separate from temporary provider backpressure.
 * A transient retry reduces pressure; sustained successful runs restore one slot.
 */
export class AdaptiveAgentConcurrency {
  private configured: number;
  private active: number;
  private successesSinceReduction = 0;

  constructor(configuredLimit: number) {
    this.configured = normalizeLimit(configuredLimit);
    this.active = this.configured;
  }

  get configuredLimit(): number {
    return this.configured;
  }

  get activeLimit(): number {
    return this.active;
  }

  configure(limit: number): void {
    const next = normalizeLimit(limit);
    if (next > this.configured) {
      this.active = next;
    } else {
      this.active = Math.min(this.active, next);
    }
    this.configured = next;
    this.successesSinceReduction = 0;
  }

  recordRetry(): void {
    this.active = Math.max(1, this.active - 1);
    this.successesSinceReduction = 0;
  }

  recordSuccess(count = 1): void {
    if (this.active >= this.configured || count < 1) return;
    this.successesSinceReduction += count;
    if (this.successesSinceReduction < this.active * 2) return;
    this.active = Math.min(this.configured, this.active + 1);
    this.successesSinceReduction = 0;
  }
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CONCURRENT_AGENT_RUNS;
  return Math.max(1, Math.min(DEFAULT_MAX_CONCURRENT_AGENT_RUNS, Math.round(value)));
}
