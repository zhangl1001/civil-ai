<template>
  <div :class="['task-bell-layer', { inline }]">
    <button
      :class="['task-bell', latest?.status, { running: hasRunning }]"
      type="button"
      aria-label="打开任务消息"
      @click="openPanel"
    >
      <BellIcon />
      <span v-if="bellCount" :class="['task-badge', { pulse: hasRunning }]">
        {{ hasRunning ? '' : bellCount }}
      </span>
    </button>

    <Teleport to="body">
      <Transition name="task-overlay">
        <div v-if="isOpen" class="task-panel-overlay" @click.self="isOpen = false">
          <Transition name="task-panel" appear>
            <section class="task-panel" role="dialog" aria-modal="true" aria-label="任务消息">
              <header class="task-panel-header">
                <div class="task-panel-title">
                  <strong>任务消息</strong>
                  <span>{{ panelSubtitle }}</span>
                </div>
                <button class="task-icon-action" type="button" aria-label="清除已完成任务消息" @click="tasksStore.clearCompleted()">
                  <Trash2Icon />
                </button>
              </header>

              <div v-if="panelTasks.length || panelAgentRuns.length" class="task-panel-list">
                <article v-for="task in panelTasks" :key="task.id" :class="['task-row', task.status]" @click="openTask(task)">
                  <span :class="['task-dot', task.status]" aria-hidden="true"></span>
                  <div class="task-main">
                    <strong>{{ task.title }}</strong>
                    <span v-if="taskContent(task)">{{ taskContent(task) }}</span>
                  </div>
                  <em :class="['task-status', task.status]">{{ task.statusText }}</em>
                  <button
                    v-if="task.canCancel"
                    class="task-cancel"
                    type="button"
                    @click.stop="tasksStore.cancel(task.id)"
                  >
                    取消
                  </button>
                  <button
                    v-else
                    class="task-clear"
                    type="button"
                    @click.stop="tasksStore.hideTask(task.id)"
                  >
                    清除
                  </button>
                </article>
                <article v-for="run in panelAgentRuns" :key="run.id" :class="['task-row', agentStatusClass(run.status)]" @click="openAgentRun(run)">
                  <span :class="['task-dot', agentStatusClass(run.status)]" aria-hidden="true"></span>
                  <div class="task-main">
                    <strong>{{ run.title }}</strong>
                    <span>{{ run.detail }}</span>
                  </div>
                  <em :class="['task-status', agentStatusClass(run.status)]">{{ run.statusText }}</em>
                  <button
                    v-if="run.canCancel"
                    class="task-cancel"
                    type="button"
                    @click.stop="cancelAgentRun(run.id)"
                  >
                    取消
                  </button>
                </article>
              </div>
              <div v-else class="task-empty">暂无任务消息</div>
            </section>
          </Transition>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { BellIcon, Trash2Icon } from 'lucide-vue-next';
import { useTasksStore } from '@/stores/tasks';
import { taskContentText, toTaskViewModel, visibleTaskRows, type TaskViewModel } from '@/tasks/TaskPresenter';
import { openTaskTarget } from '@/tasks/TaskNavigation';
import { initializeTutorRuntime } from '@/composition-root/public';
import type { AgentRunId } from '@/kernel/public';
import type { AgentRunStatus, AgentRunView } from '@/modules/agent/public';

const tasksStore = useTasksStore();
const router = useRouter();
const isOpen = ref(false);
const agentRuns = ref<readonly AgentRunView[]>([]);
let agentPoll: number | undefined;
defineProps<{
  inline?: boolean;
}>();

onMounted(() => {
  void tasksStore.init();
  void refreshAgentRuns();
  agentPoll = window.setInterval(() => {
    void refreshAgentRuns();
  }, 6000);
});

onBeforeUnmount(() => {
  if (agentPoll) window.clearInterval(agentPoll);
});

const latest = computed(() => tasksStore.latestTask);
const activeCount = computed(() => tasksStore.activeTasks.length);
const activeAgentRuns = computed(() => agentRuns.value.filter((run) => run.isActive));
const hasRunning = computed(() => tasksStore.activeTasks.some((task) => ['running', 'retrying', 'queued'].includes(task.status)) || activeAgentRuns.value.length > 0);
const unreadCount = computed(() => tasksStore.unreadCount());
const bellCount = computed(() => Math.min(activeCount.value + activeAgentRuns.value.length || unreadCount.value, 9));
const panelTasks = computed(() => visibleTaskRows(tasksStore.visibleTasks, 6).map(toTaskViewModel));
const panelAgentRuns = computed(() => agentRuns.value.slice(0, Math.max(0, 6 - panelTasks.value.length)));
const panelLatestText = computed(() => {
  if (!latest.value && agentRuns.value[0]) return [agentRuns.value[0].title, agentRuns.value[0].detail, agentRuns.value[0].statusText].filter(Boolean).join(' · ');
  const task = latest.value;
  if (!task) return '';
  const view = toTaskViewModel(task);
  const detail = taskContent(view);
  return [view.title, detail, view.statusText].filter(Boolean).join(' · ');
});
const panelSubtitle = computed(() => {
  const totalActive = activeCount.value + activeAgentRuns.value.length;
  if (totalActive) return `${totalActive} 个任务进行中`;
  return panelLatestText.value || '最近任务';
});

function openPanel() {
  isOpen.value = true;
  tasksStore.markVisibleRead();
  void refreshAgentRuns();
}

async function openTask(task: TaskViewModel) {
  const opened = await openTaskTarget(task.raw, router);
  if (opened) {
    isOpen.value = false;
    tasksStore.markVisibleRead();
  }
}

function taskContent(task: TaskViewModel): string {
  return taskContentText(task);
}

async function refreshAgentRuns() {
  try {
    const runtime = await initializeTutorRuntime();
    agentRuns.value = await runtime.getAgentRunViews.execute({ limit: 6 });
  } catch {
    agentRuns.value = [];
  }
}

async function cancelAgentRun(runId: AgentRunId) {
  const runtime = await initializeTutorRuntime();
  await runtime.cancelAgentRun.execute({ agentRunId: runId, reason: 'user_cancelled_from_task_dock' });
  await refreshAgentRuns();
}

async function openAgentRun(run: AgentRunView) {
  if (!run.linkedTaskId) return;
  const task = tasksStore.tasks.find((item) => item.id === run.linkedTaskId);
  if (!task) return;
  const opened = await openTaskTarget(task, router);
  if (opened) isOpen.value = false;
}

function agentStatusClass(status: AgentRunStatus): string {
  if (status === 'queued') return 'queued';
  if (status === 'running') return 'running';
  if (status === 'waiting_user') return 'paused';
  if (status === 'completed') return 'done';
  if (status === 'cancelled') return 'cancelled';
  return 'failed';
}
</script>

<style scoped>
.task-bell-layer {
  position: fixed;
  top: calc(10px + var(--app-safe-top));
  right: 60px;
  z-index: 42;
  pointer-events: none;
}

.task-bell-layer.inline {
  position: static;
  z-index: auto;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  pointer-events: auto;
}

.task-bell {
  position: relative;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color);
  background: rgba(255, 255, 255, .78);
  box-shadow: 0 6px 16px rgba(28, 38, 58, .08);
  backdrop-filter: blur(18px) saturate(1.25);
  -webkit-backdrop-filter: blur(18px) saturate(1.25);
  pointer-events: auto;
  cursor: pointer;
  transition: transform .18s ease, background .18s ease, border-color .18s ease, color .18s ease;
}

.task-bell svg {
  width: 18px;
  height: 18px;
}

.task-bell:active {
  transform: scale(.94);
}

.task-bell.running,
.task-bell.queued,
.task-bell.retrying {
  color: #c26d00;
  border-color: rgba(232, 150, 10, .24);
  background: rgba(255, 247, 232, .72);
  animation: taskBellPulse 1.12s ease-in-out infinite;
}

.task-bell.done,
.task-bell.cancelled {
  color: var(--text-secondary-color);
  background: rgba(255, 255, 255, .46);
}

.task-bell.failed {
  color: var(--red-color);
}

.task-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--red-color);
  color: #fff;
  border: 2px solid rgba(255, 255, 255, .88);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
  line-height: 1;
}

.task-badge.pulse {
  width: 12px;
  height: 12px;
  min-width: 12px;
  padding: 0;
  background: #e8960a;
  animation: taskBadgePulse 1s ease-in-out infinite;
}

.task-panel-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
  background: var(--app-overlay-bg);
}

.task-panel {
  width: min(100%, 520px);
  max-height: min(58dvh, 440px);
  border-radius: 20px 20px 0 0;
  border: none;
  border-bottom: none;
  background: var(--app-sheet-bg);
  box-shadow: 0 -14px 34px rgba(28, 38, 58, .12);
  overflow: hidden;
}

.task-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 14px 7px;
  border-bottom: none;
}

.task-panel-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.task-panel-title strong {
  color: var(--text-color);
  font-size: var(--type-size-control);
  line-height: 1.15;
}

.task-panel-title span {
  max-width: 270px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-icon-action {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary-color);
  background: rgba(var(--color-ink-rgb), .045);
  flex-shrink: 0;
}

.task-icon-action svg {
  width: 16px;
  height: 16px;
}

.task-panel-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: calc(min(58dvh, 440px) - 57px);
  overflow-y: auto;
  padding: 10px 10px calc(12px + env(safe-area-inset-bottom));
  overscroll-behavior: contain;
}
.task-empty {
  padding: 26px 16px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  text-align: center;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 41px;
  padding: 7px 8px;
  border-radius: 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: transform .16s ease, background .16s ease;
}

.task-row:active {
  transform: scale(.99);
  background: rgba(var(--color-ink-rgb), .045);
}

.task-row.running,
.task-row.retrying,
.task-row.queued {
  background: rgba(255, 247, 232, .48);
}

.task-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex-shrink: 0;
  background: var(--text-secondary-color);
}

.task-dot.running,
.task-dot.retrying,
.task-dot.queued {
  background: #e8960a;
  box-shadow: 0 0 0 5px rgba(232, 150, 10, .13);
}

.task-dot.done,
.task-dot.cancelled {
  background: var(--green-color);
}

.task-dot.failed {
  background: var(--red-color);
}

.task-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.task-main strong,
.task-main span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-main strong {
  color: var(--text-color);
  font-size: var(--type-size-caption);
  line-height: 1.25;
}

.task-main span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  line-height: 1.25;
}

.task-status {
  flex-shrink: 0;
  min-width: 44px;
  text-align: right;
  font-style: normal;
  font-weight: var(--type-weight-semibold);
  font-size: var(--type-size-micro);
  color: var(--text-secondary-color);
}

.task-status.running,
.task-status.retrying,
.task-status.queued {
  color: #c26d00;
}

.task-status.done {
  color: var(--green-color);
}

.task-status.failed {
  color: var(--red-color);
}

.task-cancel {
  width: 38px;
  height: 25px;
  border: none;
  border-radius: 9px;
  background: rgba(255, 59, 48, .1);
  color: var(--red-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
  font-family: inherit;
  flex-shrink: 0;
}

.task-clear {
  width: 38px;
  height: 25px;
  border: none;
  border-radius: 9px;
  background: rgba(var(--color-ink-rgb), .06);
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
  font-family: inherit;
  flex-shrink: 0;
}

.task-overlay-enter-active,
.task-overlay-leave-active {
  transition: opacity .18s ease;
}

.task-overlay-enter-from,
.task-overlay-leave-to {
  opacity: 0;
}

.task-panel-enter-active,
.task-panel-leave-active {
  transition: transform .2s ease, opacity .2s ease;
}

.task-panel-enter-from,
.task-panel-leave-to {
  opacity: 0;
  transform: translateY(18px);
}

@keyframes taskBellPulse {
  0%, 100% { box-shadow: 0 12px 28px rgba(28, 38, 58, .12); }
  50% { box-shadow: 0 12px 30px rgba(232, 150, 10, .24); }
}

@keyframes taskBadgePulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(.74); opacity: .55; }
}
</style>
