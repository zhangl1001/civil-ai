<template>
  <TransitionGroup name="task-toast" tag="div" class="task-toast-stack">
    <button
      v-for="toast in toasts"
      :key="toast.id"
      :class="['task-toast', toast.kind]"
      type="button"
      @click="openTask(toast.taskId)"
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
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { CheckCircle2Icon, CircleAlertIcon, LoaderCircleIcon, PauseCircleIcon, PlayCircleIcon, RotateCcwIcon, XCircleIcon } from 'lucide-vue-next';
import type { Component } from 'vue';
import type { LocalTask, TaskStatus } from '@/domain/task';
import { TASK_CHANGED_EVENT, taskStore } from '@/tasks/TaskStore';
import { openTaskTarget } from '@/tasks/TaskNavigation';
import { taskBrief } from '@/tasks/TaskPresenter';

type ToastKind = 'info' | 'running' | 'success' | 'warning' | 'error';

interface TaskToastItem {
  id: string;
  taskId: string;
  title: string;
  message: string;
  kind: ToastKind;
  icon: Component;
}

const toasts = ref<TaskToastItem[]>([]);
const router = useRouter();
const knownStatuses = new Map<string, TaskStatus>();
const timers = new Map<string, number>();

function toastMeta(task: LocalTask): { title: string; kind: ToastKind; icon: Component } | null {
  if (task.status === 'queued') return { title: '任务已加入', kind: 'info', icon: LoaderCircleIcon };
  if (task.status === 'running') return { title: '任务开始执行', kind: 'running', icon: PlayCircleIcon };
  if (task.status === 'retrying') return { title: '任务等待重试', kind: 'warning', icon: RotateCcwIcon };
  if (task.status === 'paused') return { title: '任务已暂停', kind: 'warning', icon: PauseCircleIcon };
  if (task.status === 'done') return { title: '任务已完成', kind: 'success', icon: CheckCircle2Icon };
  if (task.status === 'failed') return { title: '任务失败', kind: 'error', icon: CircleAlertIcon };
  if (task.status === 'cancelled') return { title: '任务已取消', kind: 'warning', icon: XCircleIcon };
  return null;
}

function removeToast(id: string): void {
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
  const timer = timers.get(id);
  if (timer) window.clearTimeout(timer);
  timers.delete(id);
}

function pushToast(task: LocalTask): void {
  const meta = toastMeta(task);
  if (!meta) return;
  const id = `${task.id}:${task.status}:${task.updatedAt}`;
  const message = [task.title, taskBrief(task)].filter(Boolean).join(' · ');
  toasts.value = [
    {
      id,
      taskId: task.id,
      title: meta.title,
      message,
      kind: meta.kind,
      icon: meta.icon
    },
    ...toasts.value.filter((toast) => toast.taskId !== task.id || toast.title !== meta.title)
  ].slice(0, 3);
  const duration = task.status === 'failed' ? 5200 : 3200;
  timers.set(id, window.setTimeout(() => removeToast(id), duration));
}

async function handleTaskChanged(event: Event): Promise<void> {
  const taskId = (event as CustomEvent<{ taskId?: string }>).detail?.taskId;
  if (!taskId) return;
  const task = await taskStore.get(taskId);
  if (!task) return;
  const previous = knownStatuses.get(task.id);
  if (previous === task.status) return;
  knownStatuses.set(task.id, task.status);
  pushToast(task);
}

function openTask(taskId: string): void {
  const toast = toasts.value.find((item) => item.taskId === taskId);
  if (toast) removeToast(toast.id);
  taskStore.get(taskId).then((task) => {
    if (task) void openTaskTarget(task, router);
  });
}

onMounted(() => {
  window.addEventListener(TASK_CHANGED_EVENT, handleTaskChanged);
});

onBeforeUnmount(() => {
  window.removeEventListener(TASK_CHANGED_EVENT, handleTaskChanged);
  timers.forEach((timer) => window.clearTimeout(timer));
  timers.clear();
});
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
