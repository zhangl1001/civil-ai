<template>
  <button
    :class="['ai-fab', { running: hasRunning, dragging: fabDragging }]"
    :style="fabStyle"
    type="button"
    @click="openFromFab"
    @pointerdown="startFabDrag"
  >
    <span class="ai-pet" aria-hidden="true">
      <CatIcon />
    </span>
    <span class="ai-bubble-tail" aria-hidden="true"></span>
    <span v-if="hasRunning" class="ai-live-dot" aria-hidden="true"></span>
  </button>

  <Teleport to="body">
    <Transition name="ai-overlay">
      <div v-if="chat.isOpen" class="ai-overlay" @click.self="chat.close()">
        <Transition name="ai-sheet" appear>
          <section
            :class="['ai-sheet', { 'has-task-process': taskRows.length, 'task-process-open': taskOpen }]"
            :style="{ height: `${sheetHeight}dvh` }"
            @click="handleSheetClick"
          >
            <div class="ai-drag-zone" @pointerdown="startResize">
              <span></span>
            </div>
            <header class="ai-header">
              <button class="session-button" type="button" data-session-menu-trigger @click.stop="sessionMenuOpen = !sessionMenuOpen">
                <strong>{{ chat.sessionTitle }}</strong>
                <ChevronDownIcon />
              </button>
              <div class="ai-header-state">
                <span>{{ headerStateText }}</span>
              </div>
              <div class="ai-header-actions">
                <button :class="['thinking-toggle', { active: chat.thinkingEnabled }]" type="button" @click="chat.setThinkingEnabled(!chat.thinkingEnabled)">
                  <BrainIcon />
                  <span>思考</span>
                </button>
                <button class="icon-btn" type="button" @click="chat.close()">
                  <XIcon />
                </button>
              </div>
            </header>

            <Transition name="process-list">
              <section v-if="sessionMenuOpen" class="session-menu" data-session-menu>
                <div class="session-menu-actions">
                  <button type="button" @click="newSession"><PlusIcon />新会话</button>
                  <button type="button" @click="deleteOtherSessions"><Trash2Icon />清理其他</button>
                </div>
                <button
                  v-for="session in chat.sessions"
                  :key="session.id"
                  :class="['session-row', { active: session.id === chat.session?.id }]"
                  type="button"
                  @click="switchSession(session.id)"
                >
                  <MessageSquareIcon />
                  <span>{{ session.title }}</span>
                  <em>{{ formatSessionTime(session.updatedAt) }}</em>
                </button>
              </section>
            </Transition>

            <div v-if="toolRows.length" :class="['tool-process', { running: hasToolRunning, open: processOpen }]" @click="processOpen = !processOpen">
              <div class="process-head">
                <span :class="['process-icon', toolRows[0]?.status]"><component :is="taskIcon(toolRows[0])" /></span>
                <strong>工具执行</strong>
                <p>{{ toolSummary }}</p>
                <b class="process-index">{{ processMetaText(toolRows) }}</b>
                <ChevronDownIcon class="process-chevron" />
              </div>
              <Transition name="process-list">
                <div v-if="processOpen" class="process-list">
                  <article v-for="task in toolRows" :key="task.id" class="process-row" @click.stop="openTask(task)">
                    <span class="process-row-main">
                      <span :class="['process-icon', task.status]"><component :is="taskIcon(task)" /></span>
                      <strong>{{ task.title }}</strong>
                      <span v-if="taskDetailText(task)">{{ taskDetailText(task) }}</span>
                    </span>
                    <em>{{ task.statusText }}</em>
                  </article>
                </div>
              </Transition>
            </div>

            <main ref="messageListRef" class="ai-messages">
              <div v-if="chat.isLoading" class="empty-state">加载对话中...</div>
              <div v-else-if="!chat.hasMessages" class="empty-state">
                <span :class="['empty-cat', { active: hasRunning }]" aria-hidden="true"><CatIcon /></span>
                <strong>需要生成题目、批改申论或整理积累时，直接说。</strong>
              </div>
              <article v-for="message in chat.messages" :key="message.id" :class="['message', message.role]">
                <span v-if="message.role !== 'user'" :class="['message-cat', { active: isStreamingAssistant(message) }]" aria-hidden="true"><CatIcon /></span>
                <p v-if="message.role === 'user'">{{ message.content }}</p>
                <p v-else-if="isStreamingAssistant(message) && !message.content" class="streaming-placeholder"><span class="typing-dot"></span>正在回复...</p>
                <MarkdownContent v-else class="md-message" :content="message.content" variant="chat" />
              </article>
            </main>

            <div v-if="taskRows.length" :class="['task-process', { running: hasTaskRunning, open: taskOpen }]" @click="taskOpen = !taskOpen">
              <div class="process-head">
                <span :class="['process-icon', taskRows[0]?.status]"><component :is="taskIcon(taskRows[0])" /></span>
                <strong>任务状态</strong>
                <p>{{ taskSummary }}</p>
                <b class="process-index">{{ processMetaText(taskRows) }}</b>
                <ChevronDownIcon class="process-chevron" />
              </div>
              <div v-if="taskOpen" class="process-list">
                <article v-for="task in taskRows" :key="task.id" class="process-row" @click.stop="openTask(task)">
                  <span class="process-row-main">
                    <span :class="['process-icon', task.status]"><component :is="taskIcon(task)" /></span>
                    <strong>{{ task.title }}</strong>
                    <span v-if="taskDetailText(task)">{{ taskDetailText(task) }}</span>
                  </span>
                  <em>{{ task.statusText }}</em>
                  <button
                    v-if="task.canCancel"
                    class="process-cancel"
                    type="button"
                    @click.stop="cancelTask(task.id)"
                  >
                    取消
                  </button>
                </article>
              </div>
            </div>

            <form class="ai-input" @submit.prevent="submit">
              <input
                ref="fileInputRef"
                class="file-input"
                type="file"
                accept=".txt,.md,.markdown,.json,.csv,text/*,application/json"
                @change="handleFileSelected"
              />
              <button class="attach-btn" type="button" @click="fileInputRef?.click()">
                <PaperclipIcon />
              </button>
              <div v-if="attachment" class="attachment-chip">
                <FileTextIcon />
                <span>{{ attachment.name }}</span>
                <button type="button" @click="attachment = null"><XIcon /></button>
              </div>
              <textarea
                v-model="draft"
                rows="1"
                placeholder="输入你的问题..."
                @keydown.enter.exact.prevent="submit"
              ></textarea>
              <button
                class="send-toggle"
                type="button"
                :class="{ stopping: chat.isSending }"
                :disabled="!chat.isSending && (!draft.trim() && !attachment)"
                :aria-label="chat.isSending ? '中断回复' : '发送'"
                @click="chat.isSending ? chat.cancelResponse() : submit()"
              >
                <OctagonXIcon v-if="chat.isSending" />
                <SendIcon v-else />
              </button>
            </form>
          </section>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  BrainIcon,
  BookOpenIcon,
  CatIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  ClockIcon,
  MessageSquareIcon,
  FileTextIcon,
  MonitorIcon,
  NewspaperIcon,
  OctagonXIcon,
  PaperclipIcon,
  PenToolIcon,
  PlusIcon,
  RotateCcwIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon
} from 'lucide-vue-next';
import { useAIChatStore } from '@/stores/aiChat';
import { useTasksStore } from '@/stores/tasks';
import { taskBelongsToSession, taskContentText, toTaskViewModel, visibleTaskRows } from '@/tasks/TaskPresenter';
import type { TaskViewModel } from '@/tasks/TaskPresenter';
import { openTaskTarget } from '@/tasks/TaskNavigation';
import { fileRepository } from '@/services/FileRepository';
import { projectRepository } from '@/services/ProjectRepository';
import { initializeTutorRuntime } from '@/composition-root/public';
import type { AIMessage } from '@/domain/ai';
import type { LocalTask, TaskStatus } from '@/domain/task';
import type { AgentRunStatus, AgentRunView } from '@/modules/agent/public';
import MarkdownContent from '@/components/MarkdownContent.vue';

const chat = useAIChatStore();
const tasks = useTasksStore();
const router = useRouter();
const draft = ref('');
const processOpen = ref(false);
const taskOpen = ref(false);
const sessionMenuOpen = ref(false);
const messageListRef = ref<HTMLElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const attachment = ref<{ name: string; content: string; path: string } | null>(null);
const sheetHeight = ref(68);
const dragStartY = ref(0);
const dragStartHeight = ref(68);
const isDragging = ref(false);
const fabPosition = ref(readFabPosition());
const fabDragging = ref(false);
const fabMoved = ref(false);
const fabStart = ref({ x: 0, y: 0, left: 0, top: 0 });
const agentRuns = ref<readonly AgentRunView[]>([]);
let agentPoll: number | undefined;

type ProcessItem = Omit<TaskViewModel, 'raw'> & {
  raw?: LocalTask;
  messageId?: string;
  linkedTaskId?: string;
};

onMounted(() => {
  void tasks.init();
  void refreshAgentRuns();
  agentPoll = window.setInterval(() => {
    void refreshAgentRuns();
  }, 3000);
});

onBeforeUnmount(() => {
  stopResize();
  if (agentPoll) window.clearInterval(agentPoll);
});

const taskRows = computed(() => {
  const sessionTasks = tasks.visibleTasks.filter(isCurrentSessionTask);
  return visibleTaskRows(sessionTasks, 2).map(toTaskViewModel);
});

const toolRows = computed<ProcessItem[]>(() => {
  const runRows = agentRuns.value
    .filter((run) => run.targetResourceType === 'chat_tool' && run.chatSessionId === chat.session?.id)
    .slice(0, 2)
    .map(agentRunToProcessItem);
  if (runRows.length) return runRows;
  return chat.messages
    .filter((message) => message.role === 'tool')
    .slice(-2)
    .reverse()
    .map(toolMessageToProcessItem);
});

const hasTaskRunning = computed(() => taskRows.value.some((task) => task.isRunningLike));
const hasToolRunning = computed(() => toolRows.value.some((task) => task.isRunningLike));
const hasRunning = computed(() => chat.isSending || hasToolRunning.value || hasTaskRunning.value);
const fabStyle = computed(() => ({
  right: '16px',
  top: `${fabPosition.value.top}px`
}));

const headerStateText = computed(() => {
  if (chat.isSending) return '正在回复';
  if (hasToolRunning.value) return '正在操作工具';
  if (hasTaskRunning.value) return '任务执行中';
  const latest = taskRows.value[0];
  if (latest?.status === 'done') return '任务已完成';
  if (latest?.status === 'failed') return '任务失败';
  if (latest?.status === 'cancelled') return '任务已取消';
  return '随时提问';
});

const toolSummary = computed(() => {
  const task = toolRows.value[0];
  if (!task) return '';
  return compactTaskSummary(task);
});

const taskSummary = computed(() => {
  const task = taskRows.value[0];
  if (!task) return '';
  return compactTaskSummary(task);
});

function toolMessageToProcessItem(message: AIMessage): ProcessItem {
  const status = toolMessageStatus(message.content);
  const lines = message.content.split('\n').map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] || '工具执行';
  const title = firstLine.replace(/^工具(执行中|完成|失败)：/, '') || message.toolName || '工具执行';
  const detail = lines.slice(1).join(' · ');
  return {
    id: `tool-message-${message.id}`,
    messageId: message.id,
    type: 'generate',
    status,
    title,
    detail,
    progressText: detail,
    statusText: status === 'running' ? '执行中' : status === 'done' ? '已完成' : '失败',
    summary: [title, detail].filter(Boolean).join(' · '),
    progress: status === 'done' ? 100 : status === 'failed' ? 100 : 30,
    canCancel: false,
    isActive: status === 'running',
    isRunningLike: status === 'running'
  };
}

function agentRunToProcessItem(run: AgentRunView): ProcessItem {
  const status = agentStatusToTaskStatus(run.status);
  return {
    id: `agent-run-${run.id}`,
    type: runTypeToTaskType(run),
    status,
    title: run.detail || run.title,
    detail: run.toolName || run.targetResourceType || '',
    progressText: run.detail,
    statusText: run.statusText,
    summary: [run.detail || run.title, run.statusText].filter(Boolean).join(' · '),
    progress: status === 'done' || status === 'failed' || status === 'cancelled' ? 100 : 30,
    canCancel: run.canCancel,
    isActive: run.isActive,
    isRunningLike: run.isActive,
    linkedTaskId: run.linkedTaskId
  };
}

function agentStatusToTaskStatus(status: AgentRunStatus): TaskStatus {
  if (status === 'queued') return 'queued';
  if (status === 'running' || status === 'waiting_user') return 'running';
  if (status === 'completed') return 'done';
  if (status === 'cancelled') return 'cancelled';
  return 'failed';
}

function runTypeToTaskType(run: AgentRunView): ProcessItem['type'] {
  if (run.toolName === 'generate_digest' || run.toolName === 'generate_monthly_digest') return 'digest';
  if (run.toolName === 'generate_mock') return 'mock';
  if (run.toolName === 'generate_essay' || run.toolName === 'grade_essay') return 'essay';
  if (run.toolName === 'redo_wrongbook') return 'redo';
  return 'generate';
}

function toolMessageStatus(content: string): TaskStatus {
  if (content.startsWith('工具失败')) return 'failed';
  if (content.startsWith('工具完成')) return 'done';
  return 'running';
}

function isCurrentSessionTask(task: LocalTask): boolean {
  const sessionId = chat.session?.id;
  const linkedTaskIds = new Set(chat.messages.map((message) => message.toolCallId).filter((id): id is string => typeof id === 'string' && id.length > 0));
  return taskBelongsToSession(task, sessionId, linkedTaskIds);
}

function taskIcon(task?: ProcessItem | TaskViewModel) {
  if (!task) return ClockIcon;
  if (task.status === 'done') return CircleCheckIcon;
  if (task.status === 'failed') return TriangleAlertIcon;
  if (task.type === 'generate') return SparklesIcon;
  if (task.type === 'grade' || task.type === 'essay') return PenToolIcon;
  if (task.type === 'digest') return NewspaperIcon;
  if (task.type === 'study') return BookOpenIcon;
  if (task.type === 'mock') return MonitorIcon;
  if (task.type === 'redo') return RotateCcwIcon;
  return FileTextIcon;
}

function processMetaText(rows: Array<ProcessItem | TaskViewModel>): string {
  const first = rows[0];
  if (!first) return '';
  return `${first.statusText} · 1/${rows.length}`;
}

function compactTaskSummary(task: ProcessItem | TaskViewModel): string {
  return [task.title, taskDetailText(task)].filter(Boolean).join(' · ');
}

function taskDetailText(task: ProcessItem | TaskViewModel): string {
  return taskContentText(task);
}

watch(
  () => chat.messages.length,
  async () => {
    void refreshAgentRuns();
    await nextTick();
    messageListRef.value?.scrollTo({ top: messageListRef.value.scrollHeight, behavior: 'smooth' });
  }
);

watch(
  () => chat.session?.id,
  () => {
    void refreshAgentRuns();
  }
);

watch(hasRunning, async () => {
  await nextTick();
  messageListRef.value?.scrollTo({ top: messageListRef.value.scrollHeight, behavior: 'smooth' });
});

function isStreamingAssistant(message: AIMessage): boolean {
  return message.role === 'assistant' && message.id === chat.streamingMessageId;
}

async function cancelTask(taskId: string) {
  await tasks.cancel(taskId);
  await chat.refreshMessages();
}

async function openTask(task: ProcessItem | TaskViewModel) {
  const linkedTaskId = 'linkedTaskId' in task ? task.linkedTaskId : undefined;
  const raw = task.raw || (linkedTaskId ? tasks.tasks.find((item) => item.id === linkedTaskId) : undefined);
  if (!raw) return;
  const opened = await openTaskTarget(raw, router);
  if (opened) {
    chat.close();
  }
}

async function refreshAgentRuns() {
  if (!chat.session?.id) {
    agentRuns.value = [];
    return;
  }
  try {
    const runtime = await initializeTutorRuntime();
    agentRuns.value = await runtime.getAgentRunViews.execute({ limit: 10 });
  } catch {
    agentRuns.value = [];
  }
}

async function submit() {
  const text = buildPromptWithAttachment(draft.value);
  draft.value = '';
  attachment.value = null;
  sessionMenuOpen.value = false;
  taskOpen.value = false;
  processOpen.value = false;
  await chat.send(text);
}

async function handleFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const content = await file.text();
  const project = await projectRepository.getActiveProject();
  const safeName = file.name.replace(/[/:\\]/g, '_');
  const path = `导入资料/${Date.now()}-${safeName}`;
  await fileRepository.writeText(project.id, path, content);
  attachment.value = {
    name: file.name,
    content: content.slice(0, 12000),
    path
  };
}

function buildPromptWithAttachment(text: string): string {
  const clean = text.trim();
  if (!attachment.value) return clean;
  return [
    clean || '请阅读并分析这个导入文件。',
    '',
    `【导入文件：${attachment.value.name}】`,
    `本地路径：${attachment.value.path}`,
    '```',
    attachment.value.content,
    '```'
  ].join('\n');
}

function openFromFab() {
  if (fabMoved.value) {
    fabMoved.value = false;
    return;
  }
  chat.open();
}

async function newSession() {
  await chat.newSession();
  sessionMenuOpen.value = false;
}

async function switchSession(sessionId: string) {
  await chat.switchSession(sessionId);
  sessionMenuOpen.value = false;
}

async function deleteOtherSessions() {
  await chat.deleteOtherSessions();
  sessionMenuOpen.value = false;
}

function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function handleSheetClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  const inSessionMenu = target.closest('[data-session-menu]') || target.closest('[data-session-menu-trigger]');
  const inTaskProcess = target.closest('.task-process');
  const inToolProcess = target.closest('.tool-process');
  if (!inSessionMenu) sessionMenuOpen.value = false;
  if (!inTaskProcess) taskOpen.value = false;
  if (!inToolProcess) processOpen.value = false;
}

function startResize(event: PointerEvent) {
  isDragging.value = true;
  dragStartY.value = event.clientY;
  dragStartHeight.value = sheetHeight.value;
  window.addEventListener('pointermove', resizeSheet);
  window.addEventListener('pointerup', stopResize, { once: true });
}

function resizeSheet(event: PointerEvent) {
  if (!isDragging.value) return;
  const delta = dragStartY.value - event.clientY;
  sheetHeight.value = clampHeight(dragStartHeight.value + (delta / window.innerHeight) * 100);
}

function stopResize() {
  if (!isDragging.value) return;
  isDragging.value = false;
  window.removeEventListener('pointermove', resizeSheet);
  const stops = [48, 68, 88];
  sheetHeight.value = stops.reduce((best, value) => {
    return Math.abs(value - sheetHeight.value) < Math.abs(best - sheetHeight.value) ? value : best;
  }, stops[0]);
}

function clampHeight(value: number): number {
  return Math.max(42, Math.min(92, value));
}

function readFabPosition() {
  const fallback = { left: Math.max(12, window.innerWidth - 74), top: Math.max(84, window.innerHeight - 160) };
  try {
    const raw = localStorage.getItem('ai-fab-position');
    const parsed = raw ? JSON.parse(raw) as { left?: number; top?: number } : {};
    return clampFabPosition({
      left: typeof parsed.left === 'number' ? parsed.left : fallback.left,
      top: typeof parsed.top === 'number' ? parsed.top : fallback.top
    });
  } catch {
    return fallback;
  }
}

function startFabDrag(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement;
  fabDragging.value = true;
  fabMoved.value = false;
  fabStart.value = {
    x: event.clientX,
    y: event.clientY,
    left: fabPosition.value.left,
    top: fabPosition.value.top
  };
  target.setPointerCapture(event.pointerId);
  window.addEventListener('pointermove', dragFab);
  window.addEventListener('pointerup', stopFabDrag, { once: true });
}

function dragFab(event: PointerEvent) {
  if (!fabDragging.value) return;
  const dx = event.clientX - fabStart.value.x;
  const dy = event.clientY - fabStart.value.y;
  if (Math.abs(dx) + Math.abs(dy) > 5) fabMoved.value = true;
  fabPosition.value = clampFabPosition({
    left: fabStart.value.left,
    top: fabStart.value.top + dy
  });
}

function stopFabDrag() {
  if (!fabDragging.value) return;
  fabDragging.value = false;
  window.removeEventListener('pointermove', dragFab);
  fabPosition.value = clampFabPosition(fabPosition.value);
  localStorage.setItem('ai-fab-position', JSON.stringify(fabPosition.value));
}

function clampFabPosition(position: { left: number; top: number }) {
  const safeTop = 12;
  const safeBottom = 12;
  const width = 58;
  const height = 52;
  return {
    left: Math.max(10, window.innerWidth - width - 16),
    top: Math.max(safeTop, Math.min(window.innerHeight - height - safeBottom, position.top))
  };
}
</script>

<style scoped>
.ai-fab {
  position: fixed;
  z-index: 20;
  width: 58px;
  height: 52px;
  border: none;
  border-radius: 22px 22px 20px 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #7c4a08;
  background:
    linear-gradient(180deg, rgba(255, 247, 232, .98), rgba(255, 226, 169, .96));
  box-shadow: 0 14px 30px rgba(232, 150, 10, .22);
  transform-origin: 76% 82%;
  touch-action: none;
  user-select: none;
}

.ai-fab.dragging {
  transition: none;
  transform: scale(1.03);
}

.ai-fab::before,
.ai-fab::after {
  content: '';
  position: absolute;
  top: -6px;
  width: 17px;
  height: 17px;
  border-radius: 5px 12px 5px 12px;
  background: rgba(255, 240, 202, .98);
  border: 1px solid rgba(124, 74, 8, .08);
  transform: rotate(45deg);
  z-index: -1;
}

.ai-fab::before {
  left: 10px;
}

.ai-fab::after {
  right: 11px;
}

.ai-pet {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, .62);
  box-shadow: inset 0 0 0 1px rgba(124, 74, 8, .06);
}

.ai-pet svg {
  width: 23px;
  height: 23px;
  stroke-width: 2.35;
}

.ai-bubble-tail {
  position: absolute;
  right: 7px;
  bottom: 2px;
  width: 12px;
  height: 12px;
  border-radius: 2px 8px 8px 8px;
  background: rgba(255, 226, 169, .96);
  transform: rotate(26deg);
}

.ai-live-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 13px;
  height: 13px;
  border-radius: 999px;
  background: #e8960a;
  border: 2px solid rgba(255, 255, 255, .9);
  box-shadow: 0 0 0 5px rgba(232, 150, 10, .14);
  animation: processBlink 1s ease-in-out infinite;
}

.ai-fab.running {
  animation: aiFabPulse 1.15s ease-in-out infinite;
}

.ai-fab.running .ai-pet,
.message-cat.active,
.message.pending .message-cat {
  animation: catThinking 1.05s ease-in-out infinite;
}

.ai-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  background: rgba(15, 23, 42, .18);
}

.ai-sheet {
  position: relative;
  width: 100%;
  max-height: 92dvh;
  min-height: 42dvh;
  display: flex;
  flex-direction: column;
  border-radius: 22px 22px 0 0;
  background: var(--app-sheet-bg);
  box-shadow: 0 -24px 60px rgba(15, 23, 42, .24);
  overflow: hidden;
  transition: height .18s ease;
  touch-action: none;
}

.ai-drag-zone {
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ns-resize;
  flex-shrink: 0;
}

.ai-drag-zone span {
  width: 42px;
  height: 5px;
  border-radius: 999px;
  background: rgba(var(--color-ink-rgb), .16);
}

.ai-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px 6px;
  border-bottom: 1px solid rgba(var(--color-ink-rgb), .06);
}

.session-button {
  min-width: 0;
  max-width: 42%;
  height: 32px;
  border: none;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  color: var(--text-color);
  background: rgba(var(--color-ink-rgb), .055);
  font-family: inherit;
}

.session-button strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--type-size-body);
}

.session-button svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.ai-header-state {
  flex: 1;
  min-width: 0;
}

.ai-header-state span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
  white-space: nowrap;
}

.ai-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}

.thinking-toggle {
  height: 30px;
  border: none;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 9px;
  color: var(--text-secondary-color);
  background: rgba(var(--color-ink-rgb), .055);
  font-family: inherit;
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.thinking-toggle.active {
  color: #7c4a08;
  background: rgba(232, 150, 10, .14);
}

.thinking-toggle svg {
  width: 14px;
  height: 14px;
}

.icon-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--color-ink-rgb), .06);
  color: var(--text-color);
}

.icon-btn svg {
  width: 18px;
  height: 18px;
}

.session-menu {
  margin: 6px 12px 0;
  padding: 8px;
  border: 1px solid rgba(var(--color-ink-rgb), .06);
  border-radius: 14px;
  background: rgba(255, 255, 255, .86);
  box-shadow: 0 12px 28px rgba(28, 38, 58, .12);
  max-height: 170px;
  overflow-y: auto;
  flex-shrink: 0;
}

.session-menu-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-bottom: 7px;
}

.session-menu-actions button,
.session-row {
  border: none;
  border-radius: 11px;
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: inherit;
}

.session-menu-actions button {
  height: 32px;
  justify-content: center;
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .09);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.session-menu svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.session-row {
  width: 100%;
  height: 34px;
  padding: 0 9px;
  color: var(--text-color);
  background: transparent;
  text-align: left;
}

.session-row.active {
  background: rgba(var(--color-ink-rgb), .055);
}

.session-row span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.session-row em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}

.tool-process,
.task-process {
  margin: 5px 12px 0;
  border: 1px solid rgba(var(--color-ink-rgb), .05);
  border-radius: 13px;
  background: rgba(255, 255, 255, .48);
  overflow: hidden;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.task-process {
  position: absolute;
  left: 12px;
  bottom: calc(62px + env(safe-area-inset-bottom));
  z-index: 5;
  width: fit-content;
  max-width: calc(100% - 24px);
  margin: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, .76);
  box-shadow: 0 10px 22px rgba(15, 23, 42, .08);
  transition: background .16s ease, opacity .16s ease, box-shadow .16s ease;
  opacity: .94;
}

.task-process.open {
  width: calc(100% - 24px);
  max-width: calc(100% - 24px);
  border-radius: 14px;
  background: rgba(255, 255, 255, .9);
  box-shadow: 0 14px 30px rgba(15, 23, 42, .11);
  opacity: 1;
}

.task-process:not(.open) .process-head {
  min-height: 28px;
  gap: 5px;
  padding: 4px 8px;
}

.task-process:not(.open) .process-head strong,
.task-process:not(.open) .process-head p {
  display: none;
}

.task-process:not(.open) .process-index {
  min-width: auto;
  height: auto;
  padding: 0;
  color: rgba(var(--color-ink-rgb), .72);
  background: transparent;
}

.task-process:not(.open) .process-chevron {
  width: 13px;
  height: 13px;
  color: rgba(var(--color-ink-rgb), .38);
}

.tool-process.running,
.task-process.running {
  border-color: rgba(232, 150, 10, .22);
}

.process-head {
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
}

.process-head strong {
  flex-shrink: 0;
  color: var(--text-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.process-head em {
  flex-shrink: 0;
  color: #c26d00;
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}

.process-index {
  flex-shrink: 0;
  min-width: 26px;
  height: 18px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary-color);
  background: rgba(var(--color-ink-rgb), .055);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.process-head p {
  min-width: 0;
  flex: 1;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--type-size-micro);
}

.process-icon {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-secondary-color);
  background: transparent;
}

.process-icon svg {
  width: 14px;
  height: 14px;
}

.process-icon.running,
.process-icon.retrying,
.process-icon.queued {
  color: #c26d00;
  background: transparent;
  box-shadow: none;
  animation: processBlink 1s ease-in-out infinite;
}

.process-icon.done {
  color: var(--green-color);
  background: transparent;
}

.process-icon.failed {
  color: var(--red-color);
  background: transparent;
}

.process-icon.cancelled,
.process-icon.paused {
  color: var(--text-secondary-color);
  background: transparent;
}

.process-chevron {
  width: 15px;
  height: 15px;
  color: rgba(var(--color-ink-rgb), .28);
  flex-shrink: 0;
  transition: transform .18s ease;
}

.tool-process.open .process-chevron,
.task-process.open .process-chevron {
  transform: rotate(180deg);
}

.process-count {
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--color-ink-rgb), .06);
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.process-list {
  max-height: 74px;
  overflow-y: auto;
  padding: 0 8px 8px;
}

.process-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 31px;
  padding: 0 7px 0 6px;
  border-radius: 10px;
  background: rgba(245, 246, 250, .64);
  cursor: pointer;
}

.process-row:active {
  transform: scale(.99);
  background: rgba(238, 241, 246, .82);
}

.process-row-main {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 5px;
}

.process-row .process-icon {
  width: 16px;
  height: 16px;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.process-row .process-icon svg {
  width: 15px;
  height: 15px;
}

.process-row + .process-row {
  margin-top: 6px;
}

.process-row strong {
  max-width: 34%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--type-size-micro);
  flex-shrink: 0;
}

.process-row-main > span:not(.process-icon) {
  min-width: 0;
  flex: 1 1 auto;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--type-size-micro);
}

.process-row em {
  flex-shrink: 0;
  color: #c26d00;
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}

.process-stop,
.process-cancel {
  flex-shrink: 0;
  height: 24px;
  border: none;
  border-radius: 999px;
  padding: 0 8px;
  background: rgba(255, 77, 79, .1);
  color: #c2412f;
  font-family: inherit;
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.process-cancel {
  height: 22px;
  padding: 0 7px;
  font-size: var(--type-size-micro);
}

.ai-messages {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
  overflow-y: auto;
}

.ai-sheet.has-task-process .ai-messages {
  padding-bottom: 48px;
}

.ai-sheet.task-process-open .ai-messages {
  padding-bottom: 116px;
}

.empty-state {
  margin: auto;
  max-width: 250px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--text-secondary-color);
  text-align: center;
  font-size: var(--type-size-secondary);
  line-height: 1.55;
}

.empty-state svg {
  width: 32px;
  height: 32px;
  color: #e8960a;
}

.empty-cat {
  width: 52px;
  height: 46px;
  border-radius: 18px 18px 16px 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #7c4a08;
  background: linear-gradient(180deg, rgba(255, 247, 232, .96), rgba(255, 226, 169, .9));
  box-shadow: 0 10px 24px rgba(232, 150, 10, .16);
}

.empty-cat svg {
  width: 28px;
  height: 28px;
}

.empty-cat.active,
.tool-process.running ~ .ai-messages .empty-cat {
  animation: catThinking 1.05s ease-in-out infinite;
}

.message {
  max-width: 84%;
  padding: 10px 12px;
  border-radius: 15px;
  line-height: 1.58;
  font-size: var(--type-size-body);
  position: relative;
}

.message p {
  margin: 0;
  white-space: pre-wrap;
}

.message.user {
  align-self: flex-end;
  color: #fff;
  background: var(--primary-color);
  border-bottom-right-radius: 5px;
}

.message.assistant,
.message.tool,
.message.system {
  align-self: flex-start;
  margin-left: 30px;
  color: var(--text-color);
  background: rgba(255, 255, 255, .86);
  border: 1px solid rgba(var(--color-ink-rgb), .06);
  border-bottom-left-radius: 5px;
}

.message-cat {
  position: absolute;
  left: -30px;
  top: 2px;
  width: 24px;
  height: 24px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #7c4a08;
  background: rgba(255, 235, 190, .86);
}

.message-cat svg {
  width: 15px;
  height: 15px;
}

.message.pending {
  color: var(--text-secondary-color);
}

.typing-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  display: inline-block;
  margin-right: 7px;
  background: #e8960a;
  vertical-align: middle;
  animation: processBlink 1s ease-in-out infinite;
}


.ai-input {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  border-top: 1px solid rgba(var(--color-ink-rgb), .06);
  background: rgba(255, 255, 255, .78);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.file-input {
  display: none;
}

.attach-btn {
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary-color);
  background: rgba(245, 246, 250, .9);
  flex-shrink: 0;
}

.attach-btn svg {
  width: 17px;
  height: 17px;
}

.attachment-chip {
  position: absolute;
  left: 12px;
  right: 58px;
  bottom: calc(55px + env(safe-area-inset-bottom));
  min-height: 30px;
  padding: 0 7px 0 9px;
  border: 1px solid rgba(var(--color-ink-rgb), .06);
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-color);
  background: rgba(255, 255, 255, .92);
  box-shadow: 0 8px 20px rgba(28, 38, 58, .1);
}

.attachment-chip > svg {
  width: 14px;
  height: 14px;
  color: var(--primary-color);
  flex-shrink: 0;
}

.attachment-chip span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.attachment-chip button {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary-color);
  background: rgba(var(--color-ink-rgb), .06);
  flex-shrink: 0;
}

.attachment-chip button svg {
  width: 13px;
  height: 13px;
}

.ai-input textarea {
  flex: 1;
  min-height: 38px;
  max-height: 104px;
  padding: 9px 12px;
  border: 1px solid rgba(var(--color-ink-rgb), .08);
  border-radius: 14px;
  outline: none;
  resize: none;
  background: rgba(245, 246, 250, .9);
  color: var(--text-color);
  line-height: 1.45;
}

.ai-input button[type="submit"] {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: var(--primary-color);
}

.ai-input button.send-toggle {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #fff;
  background: var(--primary-color);
}

.ai-input button.send-toggle.stopping {
  color: #fff;
  background: var(--red-color);
  box-shadow: 0 8px 18px rgba(255, 59, 48, .22);
}

.ai-input button[type="submit"]:disabled,
.ai-input button[type="button"]:disabled {
  opacity: .45;
}

.ai-input button[type="submit"] svg,
.ai-input button.send-toggle svg {
  width: 18px;
  height: 18px;
}

.ai-overlay-enter-active,
.ai-overlay-leave-active,
.ai-sheet-enter-active,
.ai-sheet-leave-active,
.process-list-enter-active,
.process-list-leave-active {
  transition: opacity .2s ease, transform .22s ease;
}

.task-process .process-list-enter-active,
.task-process .process-list-leave-active {
  transition: opacity .12s ease;
}

.ai-overlay-enter-from,
.ai-overlay-leave-to {
  opacity: 0;
}

.ai-sheet-enter-from,
.ai-sheet-leave-to {
  transform: translateY(28px);
  opacity: 0;
}

.process-list-enter-from,
.process-list-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.task-process .process-list-enter-from,
.task-process .process-list-leave-to {
  transform: none;
}

@keyframes processBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: .38; }
}

@keyframes aiFabPulse {
  0%, 100% { transform: scale(1); box-shadow: 0 14px 30px rgba(232, 150, 10, .28); }
  50% { transform: scale(1.04); box-shadow: 0 16px 36px rgba(232, 150, 10, .42); }
}

@keyframes catThinking {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(-2px) rotate(-4deg); }
  50% { transform: translateY(0) rotate(0deg); }
  75% { transform: translateY(-1px) rotate(4deg); }
}
</style>
