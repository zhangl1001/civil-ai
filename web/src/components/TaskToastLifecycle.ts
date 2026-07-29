import type { AgentRunStatus, AgentRunView } from '@/modules/agent/public';

/** Emits only status transitions observed after the first successful task snapshot. */
export class TaskToastLifecycle {
  private readonly statuses = new Map<string, AgentRunStatus>();
  private initialized = false;

  observe(ready: boolean, runs: readonly AgentRunView[]): readonly AgentRunView[] {
    if (!ready) return [];
    const visibleRuns = runs.filter((run) => run.taskCenterVisible !== false);
    if (!this.initialized) {
      visibleRuns.forEach((run) => this.statuses.set(run.id, run.status));
      this.initialized = true;
      return [];
    }
    const changed: AgentRunView[] = [];
    for (const run of visibleRuns) {
      const previous = this.statuses.get(run.id);
      this.statuses.set(run.id, run.status);
      if (previous !== run.status) changed.push(run);
    }
    return changed;
  }
}
