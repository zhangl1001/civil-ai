<template>
  <div :class="['task-bell-layer', { inline }]">
    <button
      :class="['task-bell', latest?.status, { running: hasRunning }]"
      type="button"
      aria-label="打开消息中心"
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
            <section class="task-panel" role="dialog" aria-modal="true" aria-label="消息中心">
              <header class="task-panel-header">
                <div class="task-panel-title">
                  <strong>消息中心</strong>
                  <span>{{ panelSubtitle }}</span>
                </div>
                <button class="task-text-action" type="button" aria-label="清空全部消息" @click="archiveAllMessages">
                  清空
                </button>
              </header>

              <nav v-if="businessFilters.length > 1" class="message-filters" aria-label="消息业务分类">
                <button
                  v-for="filter in businessFilters"
                  :key="filter.code"
                  type="button"
                  :class="{ active: selectedBusinessLine === filter.code }"
                  @click="selectedBusinessLine = filter.code"
                >
                  {{ filter.label }}
                </button>
              </nav>

              <div v-if="panelAgentRuns.length || filteredMessages.length" class="task-panel-list">
                <div v-if="panelAgentRuns.length" class="message-group-label">进行中的任务</div>
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
                <div v-if="filteredMessages.length" class="message-group-label">业务消息</div>
                <article
                  v-for="message in filteredMessages"
                  :key="message.id"
                  :class="['task-row', 'message-row', message.severity, { unread: message.status === 'unread' }]"
                  @click="openMessage(message)"
                >
                  <span :class="['task-dot', message.severity]" aria-hidden="true"></span>
                  <div class="task-main">
                    <span class="message-meta">
                      {{ businessLineLabel[message.businessLine] }}
                      · {{ categoryLabel[message.category] }}
                    </span>
                    <strong>{{ message.title }}</strong>
                    <span>{{ message.content }}</span>
                  </div>
                  <button
                    class="task-clear"
                    type="button"
                    aria-label="归档消息"
                    @click.stop="archiveMessage(message.id)"
                  >
                    <Trash2Icon />
                  </button>
                </article>
              </div>
              <div v-else class="task-empty">暂无消息</div>
            </section>
          </Transition>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import { BellIcon, Trash2Icon } from 'lucide-vue-next';
import { initializeTutorRuntime } from '@/composition-root/public';
import type { AgentRunId } from '@/kernel/public';
import type { AgentRunStatus, AgentRunView } from '@/modules/agent/public';
import { useTaskCenterStore } from '@/stores/taskCenter';
import {
  MessageBusinessLineLabel,
  MessageCategoryLabel,
  type MessageBusinessLineCode,
  type SystemMessageRecord
} from '@/modules/message-center/public';

const router = useRouter();
const taskCenter = useTaskCenterStore();
const { runs: agentRuns, messages, unreadCount } = storeToRefs(taskCenter);
const isOpen = ref(false);
const selectedBusinessLine = ref<'all' | MessageBusinessLineCode>('all');
const businessLineLabel = MessageBusinessLineLabel;
const categoryLabel = MessageCategoryLabel;
defineProps<{
  inline?: boolean;
}>();

onMounted(() => {
  taskCenter.connect();
});

onBeforeUnmount(() => {
  taskCenter.disconnect();
});

const taskAgentRuns = computed(() => agentRuns.value.filter((run) => run.taskCenterVisible));
const latest = computed(() => taskAgentRuns.value[0]);
const activeAgentRuns = computed(() => taskAgentRuns.value.filter((run) => run.isActive));
const hasRunning = computed(() => activeAgentRuns.value.length > 0);
const bellCount = computed(() => Math.min(activeAgentRuns.value.length + unreadCount.value, 9));
const panelAgentRuns = computed(() => taskAgentRuns.value.filter((run) => run.isActive).slice(0, 6));
const filteredMessages = computed(() => messages.value
  .filter((message) => selectedBusinessLine.value === 'all' || message.businessLine === selectedBusinessLine.value)
  .slice(0, 20));
const businessFilters = computed(() => {
  const present = new Set(messages.value.map((message) => message.businessLine));
  return [
    { code: 'all' as const, label: '全部' },
    ...Object.entries(MessageBusinessLineLabel)
      .filter(([code]) => present.has(code as MessageBusinessLineCode))
      .map(([code, label]) => ({ code: code as MessageBusinessLineCode, label }))
  ];
});
const panelLatestText = computed(() => {
  const run = latest.value;
  return run ? [run.title, run.detail, run.statusText].filter(Boolean).join(' · ') : '';
});
const panelSubtitle = computed(() => {
  const totalActive = activeAgentRuns.value.length;
  if (totalActive) return `${totalActive} 个任务进行中`;
  return panelLatestText.value || '最近任务';
});

function openPanel() {
  isOpen.value = true;
  void refreshAgentRuns();
  void markMessagesRead();
}

async function refreshAgentRuns() {
  await taskCenter.refresh();
}

async function refreshMessages() {
  await taskCenter.refresh();
}

async function markMessagesRead() {
  try {
    const runtime = await initializeTutorRuntime();
    await runtime.messageCenter.markAllRead();
    await refreshMessages();
  } catch {
    // The next poll retries without blocking the task center.
  }
}

async function archiveMessage(messageId: string) {
  const runtime = await initializeTutorRuntime();
  await runtime.messageCenter.archive(messageId);
  await refreshMessages();
}

async function archiveAllMessages() {
  const runtime = await initializeTutorRuntime();
  await runtime.messageCenter.archiveAll();
  await refreshMessages();
}

async function openMessage(message: SystemMessageRecord) {
  const runtime = await initializeTutorRuntime();
  await runtime.messageCenter.markRead(message.id);
  if (message.actionRoute) {
    const query = Object.fromEntries(
      Object.entries(message.actionParams)
        .filter((entry): entry is [string, string | number | boolean] => (
          typeof entry[1] === 'string' || typeof entry[1] === 'number' || typeof entry[1] === 'boolean'
        ))
        .map(([key, value]) => [key, String(value)])
    );
    await router.push({ path: message.actionRoute, query });
    isOpen.value = false;
  }
  await refreshMessages();
}

async function cancelAgentRun(runId: AgentRunId) {
  const runtime = await initializeTutorRuntime();
  await runtime.cancelAgentRun.execute({ agentRunId: runId, reason: 'user_cancelled_from_task_dock' });
  await refreshAgentRuns();
}

async function openAgentRun(run: AgentRunView) {
  if (run.actionRoute) {
    await router.push({
      path: run.actionRoute,
      query: Object.fromEntries(Object.entries(run.actionParams).map(([key, value]) => [key, String(value)]))
    });
    isOpen.value = false;
    return;
  }
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

.task-text-action {
  width: auto;
  height: 30px;
  padding: 0 9px;
  border: none;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary-color);
  background: rgba(var(--color-ink-rgb), .045);
  font: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-medium);
  flex-shrink: 0;
}

.message-filters {
  display: flex;
  gap: 6px;
  padding: 5px 12px 7px;
  overflow-x: auto;
  scrollbar-width: none;
}

.message-filters::-webkit-scrollbar {
  display: none;
}

.message-filters button {
  min-width: max-content;
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 999px;
  color: var(--text-secondary-color);
  background: rgba(var(--color-ink-rgb), .045);
  font: inherit;
  font-size: var(--type-size-micro);
}

.message-filters button.active {
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .1);
  font-weight: var(--type-weight-semibold);
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

.message-group-label {
  padding: 4px 8px 1px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.message-row.unread {
  background: rgba(var(--color-brand-rgb), .045);
}

.task-dot.info {
  background: var(--primary-color);
}

.task-dot.success {
  background: var(--green-color);
}

.task-dot.warning {
  background: #e8960a;
}

.task-dot.error {
  background: var(--red-color);
}

.task-main .message-meta {
  color: var(--primary-color);
  font-size: var(--type-size-micro);
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

.task-clear svg {
  width: 14px;
  height: 14px;
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
