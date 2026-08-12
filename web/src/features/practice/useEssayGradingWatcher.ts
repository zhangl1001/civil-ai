import { onBeforeUnmount, readonly, ref, type Ref } from 'vue';
import { EssayGradingCoordinator, initializeTutorRuntime } from '@/composition-root/public';
import { AgentRunStatus, type AgentRunView } from '@/modules/agent/public';

const POLL_INTERVAL_MS = 1_200;

interface EssayGradingWatcherOptions {
  /** Called once the grading run reaches a successful terminal state. */
  readonly onGraded: () => Promise<void> | void;
}

export interface EssayGradingWatcher {
  readonly isGrading: Readonly<Ref<boolean>>;
  readonly progressText: Readonly<Ref<string>>;
  readonly failure: Readonly<Ref<string>>;
  /** Adopts a run that was just enqueued from this page. */
  track(run: AgentRunView): void;
  /** Re-attaches to a grading run that is still in flight from an earlier visit. */
  resume(questionSetId: string): Promise<void>;
  stop(): void;
}

/**
 * Keeps the essay detail page in step with its background grading run, so feedback
 * appears without the reader having to leave and come back.
 */
export function useEssayGradingWatcher(options: EssayGradingWatcherOptions): EssayGradingWatcher {
  const isGrading = ref(false);
  const progressText = ref('');
  const failure = ref('');
  let timerId: number | null = null;
  let trackedRunId = '';
  let disposed = false;
  let watchRevision = 0;

  function stop() {
    watchRevision += 1;
    if (timerId !== null) window.clearInterval(timerId);
    timerId = null;
    trackedRunId = '';
    isGrading.value = false;
    progressText.value = '';
    failure.value = '';
  }

  function adopt(run: AgentRunView) {
    if (disposed) return;
    failure.value = '';
    if (!run.isActive) {
      void settle(run);
      return;
    }
    trackedRunId = String(run.id);
    isGrading.value = true;
    progressText.value = run.message || run.step || '批改任务已提交，正在等待执行';
    if (timerId === null) timerId = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
  }

  async function poll() {
    if (!trackedRunId) return;
    try {
      const runtime = await initializeTutorRuntime();
      const run = await new EssayGradingCoordinator(runtime).find(trackedRunId);
      if (!run) return;
      if (run.isActive) {
        progressText.value = run.message || run.step || '正在批改';
        return;
      }
      await settle(run);
    } catch (cause) {
      // A transient read failure must not kill the poll; the next tick tries again.
      console.warn('[Essay] grading poll failed', cause);
    }
  }

  async function settle(run: AgentRunView) {
    const status = run.status;
    stop();
    if (status === AgentRunStatus.Completed) {
      await options.onGraded();
      return;
    }
    failure.value = status === AgentRunStatus.Cancelled
      ? '批改任务已取消，可重新提交。'
      : run.message || run.detail || '批改任务未完成，请重新提交。';
  }

  onBeforeUnmount(() => {
    stop();
    disposed = true;
  });

  return {
    isGrading: readonly(isGrading),
    progressText: readonly(progressText),
    failure: readonly(failure),
    track: adopt,
    async resume(questionSetId: string) {
      const revision = watchRevision;
      try {
        const runtime = await initializeTutorRuntime();
        const run = await new EssayGradingCoordinator(runtime).findActive(questionSetId);
        if (run && revision === watchRevision && !disposed) adopt(run);
      } catch (cause) {
        // Failing to re-attach only costs the live progress banner, not the page.
        console.warn('[Essay] grading resume failed', cause);
      }
    },
    stop
  };
}
