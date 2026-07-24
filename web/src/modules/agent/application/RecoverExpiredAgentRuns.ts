import type { Clock, IdGenerator } from '@/kernel/public';
import type { AgentRunAggregate, AgentRunRepository } from '../contracts/AgentRunRepository';

export class RecoverExpiredAgentRuns {
  constructor(private readonly repository: AgentRunRepository, private readonly clock: Clock, private readonly ids: IdGenerator) {}
  async execute(limit = 20): Promise<readonly AgentRunAggregate[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Agent recovery limit must be between 1 and 100');
    return this.repository.recoverExpiredLeases({ now: this.clock.now(), limit, eventIds: Array.from({ length: limit }, () => this.ids.next('AgentRunEventId')) });
  }
}
