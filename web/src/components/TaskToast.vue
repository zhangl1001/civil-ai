<template>
  <TransitionGroup name="task-toast" tag="div" class="task-toast-stack">
    <button
      v-for="toast in toasts"
      :key="toast.id"
      :class="['task-toast', toast.kind]"
      type="button"
      @click="openToast(toast)"
    >
      <span class="toast-icon">
        <component :is="toast.icon" />
      </span>
      <span class="toast-copy">
        <strong>{{ toast.title }}</strong>
        <em>{{ toast.message }}</em>
      </span>
    </button>
  </TransitionGroup>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import { CheckCircle2Icon, CircleAlertIcon, LoaderCircleIcon, PauseCircleIcon, PlayCircleIcon, XCircleIcon } from 'lucide-vue-next';
import type { Component } from 'vue';
import type { AgentRunStatus, AgentRunView } from '@/modules/agent/public';
import { useTaskCenterStore } from '@/stores/taskCenter';
import { TaskToastLifecycle } from './TaskToastLifecycle';

type ToastKind = 'info' | 'running' | 'success' | 'warning' | 'error';

interface TaskToastItem {
  id: string;
  taskId: string;
  agentRunId?: AgentRunView['id'];
  actionRoute?: string;
  actionParams?: AgentRunView['actionParams'];
  title: string;
  message: string;
  kind: ToastKind;
  icon: Component;
}

const toasts = ref<TaskToastItem[]>([]);
const router = useRouter();
const taskCenter = useTaskCenterStore();
const { runs: agentRuns, initialized: taskCenterInitialized } = storeToRefs(taskCenter);
const lifecycle = new TaskToastLifecycle();
const timers = new Map<string, number>();

function toastMeta(status: AgentRunStatus): { title: string; kind: ToastKind; icon: Component } | null {
  if (status === 'queued') return { title: '任务已加入', kind: 'info', icon: LoaderCircleIcon };
  if (status === 'running') return { title: '任务开始执行', kind: 'running', icon: PlayCircleIcon };
  if (status === 'waiting_user') return { title: '任务等待确认', kind: 'warning', icon: PauseCircleIcon };
  if (status === 'completed') return { title: '任务已完成', kind: 'success', icon: CheckCircle2Icon };
  if (status === 'failed') return { title: '任务失败', kind: 'error', icon: CircleAlertIcon };
  if (status === 'cancelled') return { title: '任务已取消', kind: 'warning', icon: XCircleIcon };
  return null;
}

function removeToast(id: string): void {
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
  const timer = timers.get(id);
  if (timer) window.clearTimeout(timer);
  timers.delete(id);
}

function pushAgentToast(run: AgentRunView): void {
  const meta = toastMeta(run.status);
  if (!meta) return;
  const id = `${run.id}:${run.status}:${run.updatedAt}`;
  toasts.value = [
    {
      id,
      taskId: run.id,
      agentRunId: run.id,
      actionRoute: run.actionRoute,
      actionParams: run.actionParams,
      title: meta.title,
      message: [run.title, run.detail].filter(Boolean).join(' · '),
      kind: meta.kind,
      icon: meta.icon
    },
    ...toasts.value.filter((toast) => toast.taskId !== run.id || toast.title !== meta.title)
  ].slice(0, 3);
  const duration = run.status === 'failed' ? 5200 : 3200;
  timers.set(id, window.setTimeout(() => removeToast(id), duration));
}

function openToast(toast: TaskToastItem): void {
  removeToast(toast.id);
  if (toast.actionRoute) {
    const query = Object.fromEntries(
      Object.entries(toast.actionParams || {})
        .filter((entry): entry is [string, string | number | boolean] => (
          typeof entry[1] === 'string' || typeof entry[1] === 'number' || typeof entry[1] === 'boolean'
        ))
        .map(([key, value]) => [key, String(value)])
    );
    void router.push({ path: toast.actionRoute, query });
    return;
  }
}

function observeAgentRuns(ready: boolean, runs: readonly AgentRunView[]): void {
  lifecycle.observe(ready, runs)
    .filter((run) => run.targetResourceType !== 'chat_tool')
    .forEach(pushAgentToast);
}

onMounted(() => {
  taskCenter.connect();
});

onBeforeUnmount(() => {
  taskCenter.disconnect();
  timers.forEach((timer) => window.clearTimeout(timer));
  timers.clear();
});

watch(
  [taskCenterInitialized, agentRuns],
  ([ready, runs]) => observeAgentRuns(ready, runs),
  { immediate: true }
);
</script>

<style scoped>
.task-toast-stack {
  position: fixed;
  left: 50%;
  top: calc(10px + var(--app-safe-top));
  z-index: 60;
  width: min(360px, calc(100vw - 28px));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

.task-toast {
  width: 100%;
  min-height: 44px;
  border: 1px solid rgba(255, 255, 255, .58);
  border-radius: 999px;
  padding: 7px 12px 7px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-color);
  background: rgba(255, 255, 255, .76);
  box-shadow: 0 16px 38px rgba(28, 38, 58, .16), inset 0 1px 0 rgba(255, 255, 255, .72);
  backdrop-filter: blur(22px) saturate(1.18);
  -webkit-backdrop-filter: blur(22px) saturate(1.18);
  pointer-events: auto;
  font-family: inherit;
  text-align: left;
}

.toast-icon {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .12);
}

.toast-icon svg {
  width: 17px;
  height: 17px;
}

.toast-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.toast-copy strong,
.toast-copy em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toast-copy strong {
  font-size: var(--type-size-caption);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}

.toast-copy em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}

.task-toast.running .toast-icon {
  color: var(--primary-color);
  animation: toastPulse 1s ease-in-out infinite;
}

.task-toast.success .toast-icon {
  color: var(--green-color);
  background: rgba(52, 168, 83, .13);
}

.task-toast.warning .toast-icon {
  color: var(--orange-color);
  background: rgba(255, 149, 0, .14);
}

.task-toast.error .toast-icon {
  color: var(--red-color);
  background: rgba(255, 59, 48, .13);
}

.task-toast-enter-active,
.task-toast-leave-active {
  transition: opacity .2s ease, transform .2s ease;
}

.task-toast-enter-from,
.task-toast-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(.98);
}

@keyframes toastPulse {
  0%, 100% {
    opacity: .72;
    transform: scale(.94);
  }
  50% {
    opacity: 1;
    transform: scale(1.04);
  }
}
</style>
