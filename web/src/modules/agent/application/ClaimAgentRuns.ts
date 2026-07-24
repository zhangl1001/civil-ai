import type { Clock, IdGenerator, InstantMs } from '@/kernel/public';
import type { AgentRunAggregate, AgentRunRepository } from '../contracts/AgentRunRepository';
import { DEFAULT_MAX_CONCURRENT_AGENT_RUNS } from '../domain/AgentRunCodes';

export interface ClaimAgentRunsCommand {
  readonly workerId: string;
  readonly leaseExpiresAt: InstantMs;
  readonly limit?: number;
}

export class ClaimAgentRuns {
  constructor(private readonly repository: AgentRunRepository, private readonly clock: Clock, private readonly ids: IdGenerator) {}
  async execute(command: ClaimAgentRunsCommand): Promise<readonly AgentRunAggregate[]> {
    const limit = command.limit ?? DEFAULT_MAX_CONCURRENT_AGENT_RUNS;
    const now = this.clock.now();
    if (!command.workerId.trim() || command.leaseExpiresAt <= now || !Number.isInteger(limit) || limit < 1 || limit > DEFAULT_MAX_CONCURRENT_AGENT_RUNS) {
      throw new Error('Invalid agent run claim command');
    }
    return this.repository.claimRunnable({
      workerId: command.workerId.trim(), now, leaseExpiresAt: command.leaseExpiresAt, limit,
      eventIds: Array.from({ length: limit }, () => this.ids.next('AgentRunEventId'))
    });
  }
}
