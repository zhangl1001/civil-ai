const AGENT_WORKER_LOCK_NAME = 'zhangl-agent:agent-worker';

export interface AgentWorkerLockManager {
  request<T>(
    name: string,
    options: { readonly mode: 'exclusive'; readonly signal: AbortSignal },
    callback: () => Promise<T>
  ): Promise<T>;
}

/**
 * Browser tabs share one IndexedDB database, so only one tab may own the
 * scheduler. Individual run leases remain the correctness boundary.
 */
export function runWithAgentWorkerLeadership<T>(
  work: () => Promise<T>,
  signal: AbortSignal,
  lockManager: AgentWorkerLockManager | undefined = browserLockManager()
): Promise<T> {
  if (!lockManager) return work();
  return lockManager.request(
    AGENT_WORKER_LOCK_NAME,
    { mode: 'exclusive', signal },
    work
  );
}

function browserLockManager(): AgentWorkerLockManager | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.locks as AgentWorkerLockManager | undefined;
}
