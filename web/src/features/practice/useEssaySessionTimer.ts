import { computed, onBeforeUnmount, onMounted, readonly, ref, type ComputedRef, type Ref } from 'vue';

const TICK_MS = 1_000;
const PERSIST_EVERY_TICKS = 10;

interface StoredTimer {
  readonly elapsedMs?: number;
  readonly running?: boolean;
  readonly savedAt?: number;
}

export interface EssaySessionTimer {
  readonly elapsedText: ComputedRef<string>;
  readonly isRunning: Readonly<Ref<boolean>>;
  /** Hands the timer to a question set, persisting whatever the previous set had accrued. */
  activate(questionSetId: string): void;
  restore(): void;
  start(): void;
  /** Stops the clock and records that it is stopped, so a reload does not resume it. */
  pause(): void;
  toggle(): void;
  /** Stops and clears the stored time, used when the set is deleted. */
  clear(): void;
}

/**
 * Owns the per-question-set stopwatch: its storage key, its interval and its
 * background/foreground handling. The view only says which set is on screen.
 */
export function useEssaySessionTimer(): EssaySessionTimer {
  const elapsedMs = ref(0);
  const isRunning = ref(false);
  let storageKey: string | null = null;
  let timerId: number | null = null;
  let ticksSincePersist = 0;
  let disposed = false;

  function persist() {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        elapsedMs: elapsedMs.value,
        running: isRunning.value,
        savedAt: Date.now()
      }));
    } catch {
      // A full or blocked storage must never interrupt answering.
    }
  }

  function stop() {
    if (timerId !== null) window.clearInterval(timerId);
    timerId = null;
    isRunning.value = false;
  }

  function start() {
    if (disposed || timerId !== null || !storageKey) return;
    isRunning.value = true;
    const startedAt = Date.now() - elapsedMs.value;
    ticksSincePersist = 0;
    timerId = window.setInterval(() => {
      elapsedMs.value = Date.now() - startedAt;
      ticksSincePersist += 1;
      if (ticksSincePersist >= PERSIST_EVERY_TICKS) {
        ticksSincePersist = 0;
        persist();
      }
    }, TICK_MS);
    persist();
  }

  function restore() {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as StoredTimer;
      elapsedMs.value = saved.elapsedMs || 0;
      if (saved.running && saved.savedAt) {
        elapsedMs.value += Date.now() - saved.savedAt;
        start();
      }
    } catch {
      elapsedMs.value = 0;
    }
  }

  /**
   * Backgrounding must record the clock as still running so it resumes on return, which is
   * why the stored `running` flag is written before the interval is torn down.
   */
  function handleVisibilityChange() {
    if (document.hidden) {
      persist();
      stop();
      return;
    }
    restore();
  }

  function pause() {
    stop();
    persist();
  }

  onMounted(() => document.addEventListener('visibilitychange', handleVisibilityChange));
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    persist();
    stop();
    disposed = true;
  });

  return {
    elapsedText: computed(() => formatDuration(elapsedMs.value)),
    isRunning: readonly(isRunning),
    activate(questionSetId: string) {
      persist();
      stop();
      elapsedMs.value = 0;
      storageKey = `essay-timer:${questionSetId}`;
    },
    restore,
    start,
    pause,
    toggle() {
      if (isRunning.value) {
        pause();
        return;
      }
      start();
    },
    clear() {
      stop();
      elapsedMs.value = 0;
      try {
        if (storageKey) localStorage.removeItem(storageKey);
      } catch {
        // ignore storage failures
      }
      // Releasing the key stops a later persist from resurrecting the deleted set's record.
      storageKey = null;
    }
  };
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
