import type { AgentRunId } from '@/kernel/public';
import { sharedAgentRunOwnership, type AgentRunOwnership } from './AgentRunOwnership';

interface AgentRunExecution {
  readonly controller: AbortController;
  readonly detachParent?: () => void;
  readonly releaseOwnership: () => void;
}

/**
 * Owns in-memory cancellation signals; persisted status remains in AgentRunRepository.
 * While an execution is registered its run is also held as owned, which is how
 * recovery tells a live lease-less chat run from one a closed tab left behind.
 */
export class AgentRunExecutionRegistry {
  private readonly executions = new Map<AgentRunId, AgentRunExecution>();

  constructor(private readonly ownership: AgentRunOwnership = sharedAgentRunOwnership()) {}

  begin(runId: AgentRunId, parent?: AbortSignal): AbortSignal {
    const controller = new AbortController();
    let detachParent: (() => void) | undefined;
    if (parent) {
      if (parent.aborted) controller.abort(parent.reason);
      else {
        const abortFromParent = () => controller.abort(parent.reason);
        parent.addEventListener('abort', abortFromParent, { once: true });
        detachParent = () => parent.removeEventListener('abort', abortFromParent);
      }
    }
    return this.register(runId, controller, detachParent);
  }

  register(
    runId: AgentRunId,
    controller: AbortController,
    detachParent?: () => void
  ): AbortSignal {
    const previous = this.executions.get(runId);
    if (previous?.controller === controller) {
      this.executions.set(runId, { controller, detachParent, releaseOwnership: previous.releaseOwnership });
      return controller.signal;
    }
    if (previous) {
      previous.controller.abort('agent_run.replaced');
      previous.detachParent?.();
      previous.releaseOwnership();
    }
    this.executions.set(runId, { controller, detachParent, releaseOwnership: this.ownership.hold(runId) });
    return controller.signal;
  }

  cancel(runId: AgentRunId): void {
    this.executions.get(runId)?.controller.abort('agent_run.cancelled');
  }

  finish(runId: AgentRunId, owner?: AbortSignal): void {
    const current = this.executions.get(runId);
    if (!current || (owner && current.controller.signal !== owner)) return;
    current.detachParent?.();
    current.releaseOwnership();
    this.executions.delete(runId);
  }
}
