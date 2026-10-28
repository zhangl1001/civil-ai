import type { TransactionContext, UnitOfWork } from '@/capabilities/database/public';
import type { AgentRunId } from '@/kernel/public';
import type { AgentRunAggregate, AgentRunRepository } from '../contracts/AgentRunRepository';
import { isAgentRunVersionConflict } from '../domain/AgentRunInterruption';

/**
 * Enough for every writer one run has in practice (parallel mock batches, the
 * checkpoint store and an incoming cancellation) to land; a conflict that
 * survives this many fresh reads is a real bug and is surfaced.
 */
const MAX_AGENT_RUN_WRITE_ATTEMPTS = 5;

/**
 * Runs one read-modify-write of an Agent run inside a single unit of work.
 *
 * The aggregate is re-read inside the transaction on every attempt, so a writer
 * never replaces a version it did not see and never rolls back a lease renewal
 * it raced with. A concurrent writer that still wins (another browser tab on
 * the shared IndexedDB) costs a retry instead of failing the whole run. Lease
 * fencing is untouched: a lost lease is not a version conflict and is thrown
 * on the first attempt.
 */
export async function writeAgentRun<Result>(
  unitOfWork: UnitOfWork,
  repository: Pick<AgentRunRepository, 'findByIdInTransaction'>,
  agentRunId: AgentRunId,
  write: (current: AgentRunAggregate, context: TransactionContext) => Promise<Result>
): Promise<Result> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await unitOfWork.run(async (context) => {
        const current = await repository.findByIdInTransaction(agentRunId, context);
        if (!current) throw new Error(`Agent run does not exist: ${agentRunId}`);
        return write(current, context);
      });
    } catch (error) {
      if (!isAgentRunVersionConflict(error) || attempt >= MAX_AGENT_RUN_WRITE_ATTEMPTS) throw error;
    }
  }
}
