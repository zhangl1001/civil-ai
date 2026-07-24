<template>
  <div class="ai-task-pending app-empty-state" :class="statusClass">
    <div class="pending-mascot" :class="{ active: isActive }" aria-hidden="true">
      <div class="cat">
        <span class="cat-ear left"></span>
        <span class="cat-ear right"></span>
        <span class="cat-face">
          <i></i>
          <i></i>
          <b></b>
        </span>
      </div>
      <component :is="iconComponent" class="status-icon" />
    </div>
    <div class="pending-copy">
      <span v-if="task" class="pending-status">{{ taskStatusText(task.status) }}</span>
      <strong>{{ displayTitle }}</strong>
      <p>{{ displayDescription }}</p>
    </div>
    <div class="pending-actions">
      <button
        v-if="showPrimaryAction"
        class="pending-primary"
        type="button"
        :disabled="disabled"
        @click="emitPrimary"
      >
        <component :is="primaryIcon" />
        {{ primaryLabel }}
      </button>
      <button v-if="canCancel" class="pending-secondary danger" type="button" @click="$emit('cancel')">
        <XIcon />
        取消任务
      </button>
      <slot v-if="showCustomActions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CheckCircleIcon, RefreshCwIcon, SparklesIcon, TriangleAlertIcon, XIcon } from 'lucide-vue-next';
import type { LocalTask, TaskStatus } from '@/domain/task';
import { isActiveStatus, taskBrief, taskStatusText } from '@/tasks/TaskPresenter';

const props = withDefaults(defineProps<{
  task?: LocalTask;
  title?: string;
  description?: string;
  readyTitle?: string;
  readyDescription?: string;
  readyActionLabel?: string;
  retryActionLabel?: string;
  disabled?: boolean;
  hidePrimaryAction?: boolean;
  hideCustomActionsWhenActive?: boolean;
}>(), {
  readyTitle: '准备生成内容',
  readyDescription: '确认后由 AI 生成并写入本地数据。',
  readyActionLabel: '开始生成',
  retryActionLabel: '重新生成',
  disabled: false,
  hidePrimaryAction: false,
  hideCustomActionsWhenActive: true
});

const emit = defineEmits<{
  start: [];
  retry: [];
  cancel: [];
}>();

const isActive = computed(() => Boolean(props.task && isActiveStatus(props.task.status)));
const canCancel = computed(() => Boolean(props.task && isActiveStatus(props.task.status)));
const isRetryable = computed(() => props.task?.status === 'failed' || props.task?.status === 'cancelled');
const showPrimaryAction = computed(() => !props.hidePrimaryAction && !isActive.value);
const showCustomActions = computed(() => !props.hideCustomActionsWhenActive || !isActive.value);
const primaryLabel = computed(() => isRetryable.value ? props.retryActionLabel : props.readyActionLabel);
const primaryIcon = computed(() => isRetryable.value ? RefreshCwIcon : SparklesIcon);

function emitPrimary() {
  if (isRetryable.value) emit('retry');
  else emit('start');
}

const displayTitle = computed(() => {
  if (props.title) return props.title;
  if (!props.task) return props.readyTitle;
  if (props.task.status === 'failed') return '生成失败';
  if (props.task.status === 'cancelled') return '任务已取消';
  if (props.task.status === 'done') return '生成完成';
  return props.task.title || 'AI 正在生成';
});

const displayDescription = computed(() => {
  if (props.description) return props.description;
  if (!props.task) return props.readyDescription;
  if (props.task.status === 'failed') return props.task.error || '可以稍后重新生成。';
  if (props.task.status === 'cancelled') return '任务已取消，可以重新发起生成。';
  return taskBrief(props.task);
});

const iconComponent = computed(() => {
  const status = props.task?.status;
  if (!status || status === 'queued' || status === 'running' || status === 'retrying' || status === 'paused') return SparklesIcon;
  if (status === 'done') return CheckCircleIcon;
  if (status === 'failed') return TriangleAlertIcon;
  if (status === 'cancelled') return XIcon;
  return SparklesIcon;
});

const statusClass = computed(() => {
  const status: TaskStatus | 'ready' = props.task?.status || 'ready';
  return `status-${status}`;
});
</script>

<style scoped>
.ai-task-pending {
  min-height: 340px;
}

.pending-mascot {
  position: relative;
  width: 76px;
  height: 68px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.cat {
  position: relative;
  width: 58px;
  height: 50px;
  border-radius: 22px 22px 20px 20px;
  border-radius: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color);
  background:
    radial-gradient(circle at 33% 46%, rgba(var(--color-brand-rgb), .14) 0 3px, transparent 4px),
    radial-gradient(circle at 67% 46%, rgba(var(--color-brand-rgb), .14) 0 3px, transparent 4px),
    linear-gradient(145deg, rgba(255, 255, 255, .96), rgba(232, 241, 255, .92));
  box-shadow: 0 14px 32px rgba(var(--color-brand-rgb), .13), inset 0 0 0 1px rgba(var(--color-brand-rgb), .08);
}

.cat-ear {
  position: absolute;
  top: -8px;
  width: 20px;
  height: 20px;
  border-radius: 5px 8px 5px 8px;
  background: linear-gradient(145deg, rgba(255, 255, 255, .98), rgba(232, 241, 255, .94));
  box-shadow: inset 0 0 0 1px rgba(var(--color-brand-rgb), .08);
}

.cat-ear.left {
  left: 7px;
  transform: rotate(42deg);
}

.cat-ear.right {
  right: 7px;
  transform: rotate(48deg);
}

.cat-face {
  position: relative;
  z-index: 1;
  width: 35px;
  height: 22px;
  display: block;
}

.cat-face i {
  position: absolute;
  top: 4px;
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--primary-color);
}

.cat-face i:first-child {
  left: 6px;
}

.cat-face i:nth-child(2) {
  right: 6px;
}

.cat-face b {
  position: absolute;
  left: 50%;
  bottom: 3px;
  width: 10px;
  height: 6px;
  border-bottom: 2px solid rgba(var(--color-brand-rgb), .72);
  border-radius: 0 0 999px 999px;
  transform: translateX(-50%);
}

.status-icon {
  position: absolute;
  right: 1px;
  bottom: 2px;
  width: 22px;
  height: 22px;
  padding: 4px;
  border-radius: 999px;
  color: var(--primary-color);
  background: rgba(255, 255, 255, .9);
  box-shadow: 0 8px 18px rgba(28, 38, 58, .1);
}

.pending-mascot.active .cat {
  animation: catHop 1.18s ease-in-out infinite;
}

.pending-mascot.active .status-icon {
  animation: iconBlink 1.18s ease-in-out infinite;
}

.pending-copy {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.pending-status {
  min-height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .08);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.pending-actions {
  width: min(100%, 320px);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}

.pending-primary,
.pending-secondary {
  min-height: 42px;
  border: none;
  border-radius: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: inherit;
  font-size: var(--type-size-body);
  font-weight: var(--type-weight-semibold);
}

.pending-primary {
  flex: 1 1 156px;
  color: #fff;
  background: var(--primary-color);
}

.pending-secondary {
  flex: 1 1 126px;
  color: var(--text-color);
  background: rgba(255, 255, 255, .72);
  box-shadow: inset 0 0 0 1px rgba(var(--color-ink-rgb), .07);
}

.pending-secondary.danger {
  flex: 0 0 auto;
  min-height: 36px;
  border-radius: 999px;
  padding: 0 13px;
  color: var(--red-color);
  background: rgba(255, 59, 48, .075);
  font-size: var(--type-size-secondary);
}

.pending-primary svg,
.pending-secondary svg {
  width: 16px;
  height: 16px;
}

.pending-primary:disabled,
.pending-secondary:disabled {
  opacity: .55;
}

:slotted(.pending-choice) {
  flex: 0 0 auto;
  min-width: 118px;
  min-height: 38px;
  border: none;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 13px;
  background: rgba(255, 255, 255, .7);
  color: var(--text-color);
  font-family: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
  box-shadow: 0 8px 18px rgba(var(--color-ink-rgb), .055), inset 0 0 0 1px rgba(var(--color-ink-rgb), .035);
}

:slotted(.pending-choice svg) {
  width: 16px;
  height: 16px;
}

:slotted(.pending-choice:disabled) {
  opacity: .52;
}

.status-done .cat {
  color: var(--green-color);
  background:
    radial-gradient(circle at 33% 46%, rgba(52, 168, 83, .22) 0 3px, transparent 4px),
    radial-gradient(circle at 67% 46%, rgba(52, 168, 83, .22) 0 3px, transparent 4px),
    linear-gradient(145deg, rgba(255, 255, 255, .96), rgba(235, 249, 240, .94));
}

.status-done .status-icon {
  color: var(--green-color);
}

.status-failed .cat {
  color: var(--red-color);
  background:
    radial-gradient(circle at 33% 46%, rgba(255, 59, 48, .2) 0 3px, transparent 4px),
    radial-gradient(circle at 67% 46%, rgba(255, 59, 48, .2) 0 3px, transparent 4px),
    linear-gradient(145deg, rgba(255, 255, 255, .96), rgba(255, 237, 236, .94));
}

.status-failed .status-icon {
  color: var(--red-color);
}

.status-cancelled .cat {
  color: var(--text-secondary-color);
  background:
    radial-gradient(circle at 33% 46%, rgba(var(--color-ink-rgb), .18) 0 3px, transparent 4px),
    radial-gradient(circle at 67% 46%, rgba(var(--color-ink-rgb), .18) 0 3px, transparent 4px),
    linear-gradient(145deg, rgba(255, 255, 255, .96), rgba(239, 241, 244, .94));
}

.status-cancelled .status-icon {
  color: var(--text-secondary-color);
}

@keyframes catHop {
  0%, 100% {
    transform: translateY(0) scale(1);
  }
  50% {
    transform: translateY(-5px) scale(1.03);
  }
}

@keyframes iconBlink {
  0%, 100% {
    opacity: .72;
    transform: scale(.94);
  }
  50% {
    opacity: 1;
    transform: scale(1.06);
  }
}
</style>
