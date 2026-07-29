export const AgentExecutionBudgetTier = {
  Compact: 'compact',
  Standard: 'standard',
  Research: 'research',
  LongRunning: 'long_running'
} as const;

export type AgentExecutionBudgetTier = typeof AgentExecutionBudgetTier[keyof typeof AgentExecutionBudgetTier];

export interface AgentExecutionBudgetLimits {
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  readonly maxWallTimeMs: number;
}

export interface AgentExecutionBudgetDecision {
  readonly allowed: boolean;
  readonly reasonCode?: string;
}

interface AgentExecutionBudgetProfile {
  readonly rank: number;
  readonly softTurns: number;
  readonly softToolCalls: number;
  readonly softWallTimeMs: number;
  readonly hardTurns: number;
  readonly hardToolCalls: number;
  readonly hardWallTimeMs: number;
  readonly turnExtension: number;
  readonly toolCallExtension: number;
  readonly wallTimeExtensionMs: number;
}

const profiles: Readonly<Record<AgentExecutionBudgetTier, AgentExecutionBudgetProfile>> = {
  [AgentExecutionBudgetTier.Compact]: {
    rank: 0,
    softTurns: 8,
    softToolCalls: 12,
    softWallTimeMs: 240_000,
    hardTurns: 12,
    hardToolCalls: 24,
    hardWallTimeMs: 480_000,
    turnExtension: 2,
    toolCallExtension: 4,
    wallTimeExtensionMs: 60_000
  },
  [AgentExecutionBudgetTier.Standard]: {
    rank: 1,
    softTurns: 12,
    softToolCalls: 24,
    softWallTimeMs: 360_000,
    hardTurns: 18,
    hardToolCalls: 36,
    hardWallTimeMs: 600_000,
    turnExtension: 3,
    toolCallExtension: 6,
    wallTimeExtensionMs: 90_000
  },
  [AgentExecutionBudgetTier.Research]: {
    rank: 2,
    softTurns: 16,
    softToolCalls: 32,
    softWallTimeMs: 480_000,
    hardTurns: 24,
    hardToolCalls: 48,
    hardWallTimeMs: 720_000,
    turnExtension: 4,
    toolCallExtension: 8,
    wallTimeExtensionMs: 120_000
  },
  [AgentExecutionBudgetTier.LongRunning]: {
    rank: 3,
    softTurns: 20,
    softToolCalls: 40,
    softWallTimeMs: 600_000,
    hardTurns: 32,
    hardToolCalls: 64,
    hardWallTimeMs: 900_000,
    turnExtension: 4,
    toolCallExtension: 8,
    wallTimeExtensionMs: 120_000
  }
};

/** Runtime-owned soft budget. New successful evidence permits bounded expansion. */
export class AgentExecutionBudget {
  private tier: AgentExecutionBudgetTier = AgentExecutionBudgetTier.Compact;
  private profile: AgentExecutionBudgetProfile = profiles[this.tier];
  private grantedTurns = 0;
  private grantedToolCalls = 0;
  private grantedWallTimeMs = 0;
  private progressVersion = 0;
  private extensionProgressVersion = 0;
  private readonly startedAtMs: number;

  constructor(
    private readonly limits: AgentExecutionBudgetLimits,
    tiers: readonly AgentExecutionBudgetTier[] = [],
    private readonly now: () => number = monotonicNowMs
  ) {
    this.startedAtMs = now();
    this.activate(tiers);
  }

  activate(tiers: readonly AgentExecutionBudgetTier[]): void {
    const nextTier = tiers.reduce((selected, candidate) => {
      const normalized = profiles[candidate] ? candidate : AgentExecutionBudgetTier.Standard;
      return profiles[normalized].rank > profiles[selected].rank ? normalized : selected;
    }, this.tier);
    if (nextTier !== this.tier) {
      this.tier = nextTier;
      this.profile = profiles[nextTier];
      this.extensionProgressVersion = this.progressVersion;
    }
    this.grantedTurns = Math.max(this.grantedTurns, Math.min(this.profile.softTurns, this.hardTurns));
    this.grantedToolCalls = Math.max(this.grantedToolCalls, Math.min(this.profile.softToolCalls, this.hardToolCalls));
    this.grantedWallTimeMs = Math.max(
      this.grantedWallTimeMs,
      Math.min(this.profile.softWallTimeMs, this.hardWallTimeMs)
    );
  }

  recordProgress(count = 1): void {
    if (Number.isInteger(count) && count > 0) this.progressVersion += count;
  }

  allowNextTurn(turnCount: number, toolCallCount: number): AgentExecutionBudgetDecision {
    return this.ensureCapacity(turnCount + 1, toolCallCount);
  }

  allowToolCalls(turnCount: number, toolCallCount: number, requested: number): AgentExecutionBudgetDecision {
    return this.ensureCapacity(turnCount, toolCallCount + requested);
  }

  private ensureCapacity(nextTurns: number, nextToolCalls: number): AgentExecutionBudgetDecision {
    const elapsedMs = Math.max(0, this.now() - this.startedAtMs);
    const hardReason = this.hardLimitReason(nextTurns, nextToolCalls, elapsedMs);
    if (hardReason) return { allowed: false, reasonCode: hardReason };
    if (
      nextTurns <= this.grantedTurns
      && nextToolCalls <= this.grantedToolCalls
      && elapsedMs < this.grantedWallTimeMs
    ) {
      return { allowed: true };
    }
    if (this.progressVersion <= this.extensionProgressVersion) {
      return { allowed: false, reasonCode: 'agent.no_progress_budget_exhausted' };
    }
    this.grantedTurns = Math.min(this.hardTurns, this.grantedTurns + this.profile.turnExtension);
    this.grantedToolCalls = Math.min(this.hardToolCalls, this.grantedToolCalls + this.profile.toolCallExtension);
    this.grantedWallTimeMs = Math.min(
      this.hardWallTimeMs,
      this.grantedWallTimeMs + this.profile.wallTimeExtensionMs
    );
    this.extensionProgressVersion = this.progressVersion;
    const reason = this.hardLimitReason(nextTurns, nextToolCalls, elapsedMs);
    if (reason) return { allowed: false, reasonCode: reason };
    return nextTurns <= this.grantedTurns
      && nextToolCalls <= this.grantedToolCalls
      && elapsedMs < this.grantedWallTimeMs
      ? { allowed: true }
      : { allowed: false, reasonCode: 'agent.progress_budget_exhausted' };
  }

  private hardLimitReason(nextTurns: number, nextToolCalls: number, elapsedMs: number): string | undefined {
    if (nextTurns > this.hardTurns) return 'agent.turn_hard_limit';
    if (nextToolCalls > this.hardToolCalls) return 'agent.tool_hard_limit';
    if (elapsedMs >= this.hardWallTimeMs) return 'agent.time_hard_limit';
    return undefined;
  }

  private get hardTurns(): number {
    return Math.min(this.profile.hardTurns, this.limits.maxTurns);
  }

  private get hardToolCalls(): number {
    return Math.min(this.profile.hardToolCalls, this.limits.maxToolCalls);
  }

  private get hardWallTimeMs(): number {
    return Math.min(this.profile.hardWallTimeMs, this.limits.maxWallTimeMs);
  }
}

export function isAgentExecutionBudgetTier(value: string): value is AgentExecutionBudgetTier {
  return Object.values(AgentExecutionBudgetTier).includes(value as AgentExecutionBudgetTier);
}

function monotonicNowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}
