import type { Clock, IdGenerator, InstantMs } from '@/kernel/public';
import type { AgentRunAggregate, AgentRunRepository } from '../contracts/AgentRunRepository';
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

  async renew(runIds: readonly AgentRunAggregate['run']['id'][], workerId: string, leaseMs: number): Promise<void> {
    const leaseExpiresAt = (this.clock.now() + leaseMs) as InstantMs;
    await Promise.all(runIds.map((runId) => this.repository.renewLease(runId, workerId, leaseExpiresAt)));
  }
}
