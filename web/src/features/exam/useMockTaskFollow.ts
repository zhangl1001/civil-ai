import { onBeforeUnmount } from 'vue';
import { initializeTutorRuntime } from '@/composition-root/public';
import type { AgentRunView } from '@/modules/agent/public';
import type { RouteLocationRaw } from 'vue-router';

const MOCK_TASK_POLL_MS = 1_500;

/** The completed task carries its own paper and subject-specific entry params. */
export function completedMockTaskLocation(task: AgentRunView): RouteLocationRaw | undefined {
  if (!task.actionRoute || (!task.actionParams.manifestId && !task.actionParams.questionSetId)) return undefined;
  const query = Object.fromEntries(Object.entries(task.actionParams).flatMap(([key, value]) => (
    typeof value === 'string' || typeof value === 'number' ? [[key, String(value)]] : []
  )));
  return { path: task.actionRoute, query };
}

/**
 * "生成并进入" follows the mock task it queued: when that task finishes while
 * the page is still open, the page is told so it can reload its records and
 * enter the new paper. Leaving the page stops following; the task keeps
 * running and its notification still leads to the paper.
 */
export function useMockTaskFollow(
  onCompleted: (task: AgentRunView, signal: AbortSignal) => Promise<void>,
  onFailed: (task: AgentRunView) => void
) {
  let timer: number | undefined;
  let followedId: AgentRunView['id'] | undefined;
  let controller: AbortController | undefined;
  let disposed = false;

  function stop(): void {
    controller?.abort();
    controller = undefined;
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
    followedId = undefined;
  }

  function follow(task: AgentRunView): void {
    stop();
    if (disposed || !task.isActive) return;
    controller = new AbortController();
    followedId = task.id;
    timer = window.setInterval(() => void poll(), MOCK_TASK_POLL_MS);
  }

  async function poll(): Promise<void> {
    const id = followedId;
    const signal = controller?.signal;
    if (!id || !signal || signal.aborted) return;
    try {
      const runtime = await initializeTutorRuntime();
      if (signal.aborted) return;
      const task = await runtime.getAgentRunViews.findById(id);
      // A poll that resolves after the page left (or after a newer follow) is dropped.
      if (!task || signal.aborted || id !== followedId || task.isActive) return;
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
      followedId = undefined;
      if (task.status === 'completed') await onCompleted(task, signal);
      else onFailed(task);
    } catch {
      // The next poll retries; the task centre still shows the task either way.
    }
  }

  onBeforeUnmount(() => { disposed = true; stop(); });
  return { follow, stop };
}
