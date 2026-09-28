import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import type { Router } from 'vue-router';
import { initializeTutorRuntime } from '@/composition-root/public';
import type { AgentRunView } from '@/modules/agent/public';
import { QuestionSetEntryMode } from '@/modules/content/public';
import { actionQuery, StructuredPracticeTaskCenter } from './StructuredPracticeTaskCenter';
import type { PracticeCenterMode } from './usePracticeQuestionSetPagination';

const TASK_POLL_INTERVAL_MS = 1_200;

interface PracticeCenterTaskOptions {
  readonly router: Router;
  /**
   * Whether the page that owns the tasks is still mounted and still the current
   * route. Work that resolves after the user left must not move them anywhere.
   */
  readonly isPageActive: () => boolean;
  /** Runs right before the page follows a finished task, e.g. to consume `start=1`. */
  readonly beforeFollow: () => Promise<void>;
  readonly reloadTrueQuestionSets: () => Promise<void>;
  readonly reloadGeneratedQuestionSets: (mode: 'tutor' | 'self') => Promise<void>;
  readonly reportError: (message: string) => void;
}

/**
 * Tracks the practice centre's generation tasks and follows the foreground one
 * into its session once it completes.
 *
 * The poll is tied to the component lifecycle itself: it starts on mount and
 * stops on unmount, so it cannot be created after a page that was left during
 * its initial loading, and a poll already in flight when the user leaves never
 * pushes them into a session from another page.
 */
export function usePracticeCenterTasks(options: PracticeCenterTaskOptions) {
  const tutorTask = ref<AgentRunView | null>(null);
  const selfTask = ref<AgentRunView | null>(null);
  const trueTask = ref<AgentRunView | null>(null);
  const foregroundTaskId = ref('');
  let followedTaskId = '';
  let pollTimer: number | undefined;

  onMounted(() => {
    pollTimer = window.setInterval(() => void refreshTasks(), TASK_POLL_INTERVAL_MS);
  });
  onBeforeUnmount(() => {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  });

  function taskSlot(mode: PracticeCenterMode): Ref<AgentRunView | null> {
    return mode === 'tutor' ? tutorTask : mode === 'self' ? selfTask : trueTask;
  }

  function restoreTasks(activeRuns: readonly AgentRunView[]): void {
    tutorTask.value = activeRuns.find((item) => taskMode(item) === 'tutor') || null;
    selfTask.value = activeRuns.find((item) => taskMode(item) === 'self') || null;
    trueTask.value = activeRuns.find((item) => taskMode(item) === 'true') || null;
    if (tutorTask.value || selfTask.value || trueTask.value) {
      void initializeTutorRuntime().then((runtime) => new StructuredPracticeTaskCenter(runtime).resume());
    }
  }

  /** Makes a newly created task the one the page follows when it completes. */
  function trackTask(task: AgentRunView, mode: PracticeCenterMode): void {
    taskSlot(mode).value = task;
    foregroundTaskId.value = task.id;
  }

  async function cancelTask(mode: PracticeCenterMode): Promise<void> {
    const slot = taskSlot(mode);
    const task = slot.value;
    if (!task) return;
    const runtime = await initializeTutorRuntime();
    await new StructuredPracticeTaskCenter(runtime).cancel(task);
    if (slot.value?.id === task.id) slot.value = null;
    if (foregroundTaskId.value === task.id) foregroundTaskId.value = '';
  }

  async function refreshTasks(): Promise<void> {
    const tracked = [tutorTask.value, selfTask.value, trueTask.value]
      .filter((item): item is AgentRunView => Boolean(item?.id && item.isActive));
    if (!tracked.length || !options.isPageActive()) return;
    try {
      const runtime = await initializeTutorRuntime();
      const refreshed = (await Promise.all(tracked.map((item) => runtime.getAgentRunViews.findById(item.id))))
        .filter((item): item is AgentRunView => Boolean(item));
      if (!options.isPageActive()) return;
      for (const task of refreshed) {
        taskSlot(taskMode(task)).value = task;
        if (task.status === 'failed' && task.id === foregroundTaskId.value) {
          options.reportError(task.detail || '生成练习失败');
        }
      }
      const completedModes = [...new Set(refreshed.filter((task) => !task.isActive).map(taskMode))];
      await Promise.all(completedModes.map((mode) => (
        mode === 'true' ? options.reloadTrueQuestionSets() : options.reloadGeneratedQuestionSets(mode)
      )));
      const finished = refreshed.find((task) => (
        task.id === foregroundTaskId.value
        && task.status === 'completed'
        && followedTaskId !== task.id
        && (opensSession(task) || opensResearchDraft(task))
      ));
      if (finished && options.isPageActive()) await follow(finished);
    } catch {
      // A later poll or pull-to-refresh restores durable task state.
    }
  }

  async function follow(task: AgentRunView): Promise<void> {
    followedTaskId = task.id;
    foregroundTaskId.value = '';
    await options.beforeFollow();
    if (!options.isPageActive()) return;
    const fallbackPath = opensSession(task) ? '/vue/practice/objective-session' : '/vue/practice';
    await options.router.push({ path: task.actionRoute || fallbackPath, query: actionQuery(task) });
  }

  return { tutorTask, selfTask, trueTask, restoreTasks, trackTask, cancelTask };
}

function opensSession(task: AgentRunView): boolean {
  return Boolean(task.questionSetId && task.learningThreadId);
}

function opensResearchDraft(task: AgentRunView): boolean {
  return taskMode(task) === 'true' && typeof task.actionParams.draftId === 'string';
}

function taskMode(task: AgentRunView): PracticeCenterMode {
  if (task.scopeKey?.startsWith('trueQuestionResearch:')) return 'true';
  if (task.actionParams.mode === QuestionSetEntryMode.Tutor) return QuestionSetEntryMode.Tutor;
  if (task.actionParams.mode === QuestionSetEntryMode.Self) return QuestionSetEntryMode.Self;
  return task.scopeKey?.startsWith('practice:tutor:')
    ? QuestionSetEntryMode.Tutor
    : QuestionSetEntryMode.Self;
}
