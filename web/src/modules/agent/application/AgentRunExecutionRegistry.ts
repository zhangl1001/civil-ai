import type { AgentRunId } from '@/kernel/public';

interface AgentRunExecution {
  readonly controller: AbortController;
  readonly detachParent?: () => void;
}

/** Owns in-memory cancellation signals; persisted status remains in AgentRunRepository. */
export class AgentRunExecutionRegistry {
  private readonly executions = new Map<AgentRunId, AgentRunExecution>();

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
    if (previous?.controller !== controller) {
      previous?.controller.abort('agent_run.replaced');
      previous?.detachParent?.();
    }
    this.executions.set(runId, { controller, detachParent });
    return controller.signal;
  }

  cancel(runId: AgentRunId): void {
    this.executions.get(runId)?.controller.abort('agent_run.cancelled');
  }

  finish(runId: AgentRunId, owner?: AbortSignal): void {
    const current = this.executions.get(runId);
    if (!current || (owner && current.controller.signal !== owner)) return;
    current.detachParent?.();
    this.executions.delete(runId);
  }
}
