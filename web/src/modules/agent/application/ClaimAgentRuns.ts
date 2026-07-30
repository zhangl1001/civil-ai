import type { AgentRunId, Clock, IdGenerator, InstantMs } from '@/kernel/public';
import { leaseTokenOf, type AgentRunAggregate, type AgentRunRepository } from '../contracts/AgentRunRepository';
import {
  AgentExecutionClass,
  AgentWorkPool,
  DEFAULT_MAX_CONCURRENT_AGENT_RUNS,
  type AgentExecutionClass as AgentExecutionClassValue,
  type AgentWorkPool as AgentWorkPoolValue
} from '../domain/AgentRunCodes';

export interface ClaimAgentRunsCommand {
  readonly workerId: string;
  readonly leaseExpiresAt: InstantMs;
  readonly limit?: number;
  readonly workPools?: readonly AgentWorkPoolValue[];
  readonly executionClasses?: readonly AgentExecutionClassValue[];
}

export class ClaimAgentRuns {
  constructor(private readonly repository: AgentRunRepository, private readonly clock: Clock, private readonly ids: IdGenerator) {}
  async execute(command: ClaimAgentRunsCommand): Promise<readonly AgentRunAggregate[]> {
    const limit = command.limit ?? DEFAULT_MAX_CONCURRENT_AGENT_RUNS;
    const now = this.clock.now();
    if (!command.workerId.trim() || command.leaseExpiresAt <= now || !Number.isInteger(limit) || limit < 1 || limit > DEFAULT_MAX_CONCURRENT_AGENT_RUNS) {
      throw new Error('Invalid agent run claim command');
    }
    if (
      command.workPools?.length
      && command.workPools.some((pool) => !Object.values(AgentWorkPool).includes(pool))
    ) {
      throw new Error('Invalid agent run work pool');
    }
    if (
      command.executionClasses?.length
      && command.executionClasses.some((value) => !Object.values(AgentExecutionClass).includes(value))
    ) {
      throw new Error('Invalid agent run execution class');
    }
    return this.repository.claimRunnable({
      workerId: command.workerId.trim(), now, leaseExpiresAt: command.leaseExpiresAt, limit,
      eventIds: Array.from({ length: limit }, () => this.ids.next('AgentRunEventId')),
      workPools: command.workPools,
      executionClasses: command.executionClasses
    });
  }

  async renew(runs: readonly AgentRunAggregate[], workerId: string, leaseMs: number): Promise<readonly AgentRunId[]> {
    if (!workerId.trim() || !Number.isInteger(leaseMs) || leaseMs < 10_000) {
      throw new Error('Invalid agent run lease renewal command');
    }
    const now = this.clock.now();
    const leaseExpiresAt = (now + leaseMs) as InstantMs;
    const renewed = await Promise.all(runs.map(async ({ run }) => {
      const token = leaseTokenOf(run);
      if (!token || token.workerId !== workerId.trim()) return false;
      return this.repository.renewLease(token, now, leaseExpiresAt);
    }));
    return runs
      .filter((_, index) => !renewed[index])
      .map(({ run }) => run.id);
  }
}
