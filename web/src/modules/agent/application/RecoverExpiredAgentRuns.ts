import { AI_EXECUTION_BUDGET } from '@/capabilities/ai-runtime/public';
import type { Clock, IdGenerator, InstantMs } from '@/kernel/public';
import type { AgentRunAggregate, AgentRunRepository } from '../contracts/AgentRunRepository';
import { ORPHANED_FOREGROUND_RUN_REASON } from '../domain/ForegroundAgentRuns';
import { sharedAgentRunOwnership, type AgentRunOwnership } from './AgentRunOwnership';

/**
 * When other contexts cannot be observed, only a run untouched for longer than
 * a foreground run may live (the chat's hard execution ceiling) is provably
 * ownerless; a run a live tab is still driving is younger than that.
 */
const UNOBSERVED_OWNER_HORIZON_MS = AI_EXECUTION_BUDGET.chatRunMs + 60_000;

/**
 * The chat starts its queued run within milliseconds of creating it; a queued
 * chat run this old was left behind by a crash between the two steps.
 */
const QUEUED_FOREGROUND_START_GRACE_MS = 30_000;

export class RecoverExpiredAgentRuns {
  constructor(
    private readonly repository: AgentRunRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly ownership: AgentRunOwnership = sharedAgentRunOwnership()
  ) {}

  /**
   * Requeues runs whose worker lease expired, and closes as interrupted the
   * foreground (lease-less) runs no live controller owns: after a crash, a
   * reload or a closed tab nothing else would ever finish them.
   */
  async execute(limit = 20): Promise<readonly AgentRunAggregate[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Agent recovery limit must be between 1 and 100');
    // Read the time before ownership: a controller that registers after the
    // snapshot writes its run after this instant, so the run cannot qualify.
    const now = this.clock.now();
    const owners = await this.ownership.snapshot();
    const horizon = owners.coversOtherContexts ? 0 : UNOBSERVED_OWNER_HORIZON_MS;
    return this.repository.recoverExpiredLeases({
      now,
      limit,
      eventIds: this.eventIds(limit),
      orphans: {
        ownedRunIds: [...owners.ownedRunIds],
        runningUpdatedBefore: (now - horizon) as InstantMs,
        queuedUpdatedBefore: (now - Math.max(horizon, QUEUED_FOREGROUND_START_GRACE_MS)) as InstantMs,
        reasonCode: ORPHANED_FOREGROUND_RUN_REASON,
        eventIds: this.eventIds(limit)
      }
    });
  }

  private eventIds(limit: number): readonly string[] {
    return Array.from({ length: limit }, () => this.ids.next('AgentRunEventId'));
  }
}
