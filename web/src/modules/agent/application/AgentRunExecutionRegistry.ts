import type { AgentRunId } from '@/kernel/public';

/** Owns in-memory cancellation signals; persisted status remains in AgentRunRepository. */
export class AgentRunExecutionRegistry {
  private readonly controllers = new Map<AgentRunId, AbortController>();

  begin(runId: AgentRunId, parent?: AbortSignal): AbortSignal {
    this.cancel(runId);
    const controller = new AbortController();
    if (parent) {
      if (parent.aborted) controller.abort(parent.reason);
      else parent.addEventListener('abort', () => controller.abort(parent.reason), { once: true });
    }
    this.controllers.set(runId, controller);
    return controller.signal;
  }

  cancel(runId: AgentRunId): void {
    this.controllers.get(runId)?.abort('agent_run.cancelled');
  }

  finish(runId: AgentRunId): void {
    this.controllers.delete(runId);
  }
}
