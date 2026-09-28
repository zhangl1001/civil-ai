import { onBeforeUnmount } from 'vue';
import { initializeTutorRuntime } from '@/composition-root/public';
import type { AgentRunView } from '@/modules/agent/public';

const MOCK_TASK_POLL_MS = 1_500;

/**
 * "生成并进入" follows the mock task it queued: when that task finishes while
 * the page is still open, the page is told so it can reload its records and
 * enter the new paper. Leaving the page stops following; the task keeps
 * running and its notification still leads to the paper.
 */
export function useMockTaskFollow(
  onCompleted: (task: AgentRunView) => Promise<void>,
  onFailed: (task: AgentRunView) => void
) {
  let timer: number | undefined;
  let followedId: AgentRunView['id'] | undefined;

  function stop(): void {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
    followedId = undefined;
  }

  function follow(task: AgentRunView): void {
    stop();
    if (!task.isActive) return;
    followedId = task.id;
    timer = window.setInterval(() => void poll(), MOCK_TASK_POLL_MS);
  }

  async function poll(): Promise<void> {
    const id = followedId;
    if (!id) return;
    try {
      const runtime = await initializeTutorRuntime();
      const task = await runtime.getAgentRunViews.findById(id);
      // A poll that resolves after the page left (or after a newer follow) is dropped.
      if (!task || id !== followedId || task.isActive) return;
      stop();
      if (task.status === 'completed') await onCompleted(task);
      else onFailed(task);
    } catch {
      // The next poll retries; the task centre still shows the task either way.
    }
  }

  onBeforeUnmount(stop);
  return { follow, stop };
}
