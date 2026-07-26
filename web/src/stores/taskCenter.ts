import { defineStore } from 'pinia';
import { ref } from 'vue';
import { initializeTutorRuntime } from '@/composition-root/public';
import type { AgentRunView } from '@/modules/agent/public';
import type { SystemMessageRecord } from '@/modules/message-center/public';

const REFRESH_INTERVAL_MS = 1_500;
const RUN_LIMIT = 50;
const MESSAGE_LIMIT = 100;

/** Single client-side read model for every task, tool-process and notification surface. */
export const useTaskCenterStore = defineStore('taskCenter', () => {
  const runs = ref<readonly AgentRunView[]>([]);
  const messages = ref<readonly SystemMessageRecord[]>([]);
  const unreadCount = ref(0);
  const initialized = ref(false);
  let subscribers = 0;
  let timer: number | undefined;
  let refreshPromise: Promise<void> | undefined;

  function connect(): void {
    subscribers += 1;
    if (subscribers !== 1) return;
    document.addEventListener('visibilitychange', handleVisibility);
    void refresh();
    timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, REFRESH_INTERVAL_MS);
  }

  function disconnect(): void {
    subscribers = Math.max(0, subscribers - 1);
    if (subscribers) return;
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
    document.removeEventListener('visibilitychange', handleVisibility);
  }

  function refresh(): Promise<void> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = refreshNow().finally(() => {
      refreshPromise = undefined;
    });
    return refreshPromise;
  }

  async function refreshNow(): Promise<void> {
    try {
      const runtime = await initializeTutorRuntime();
      const [nextRuns, nextMessages, nextUnreadCount] = await Promise.all([
        runtime.getAgentRunViews.execute({ limit: RUN_LIMIT }),
        runtime.messageCenter.list({ limit: MESSAGE_LIMIT }),
        runtime.messageCenter.countUnread()
      ]);
      runs.value = nextRuns;
      messages.value = nextMessages;
      unreadCount.value = nextUnreadCount;
      initialized.value = true;
    } catch {
      // Preserve the last successful snapshot during app-resume and database-open races.
    }
  }

  function handleVisibility(): void {
    if (document.visibilityState === 'visible') void refresh();
  }

  return {
    runs,
    messages,
    unreadCount,
    initialized,
    connect,
    disconnect,
    refresh
  };
});
