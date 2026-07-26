<template>
  <button
    :class="['ai-fab', { running: hasRunning, dragging: fabDragging }]"
    :style="fabStyle"
    type="button"
    aria-label="打开 AI 私教"
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
            :class="['ai-sheet', { 'has-task-process': taskRows.length, 'task-process-open': taskOpen, 'keyboard-open': isKeyboardOpen }]"
            :style="sheetStyle"
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
                <span v-if="headerStateText">{{ headerStateText }}</span>
              </div>
              <div class="ai-header-actions">
                <button class="icon-btn" type="button" title="关闭" aria-label="关闭" @click="chat.close()">
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
              <div v-else-if="!displayMessages.length" class="empty-state">
                <span :class="['empty-cat', { active: hasRunning }]" aria-hidden="true"><CatIcon /></span>
                <strong>需要生成题目、批改申论或整理积累时，直接说。</strong>
              </div>
              <article v-for="message in displayMessages" :key="message.id" :class="['message', message.role]">
                <span v-if="message.role !== 'user'" :class="['message-cat', { active: isStreamingAssistant(message) }]" aria-hidden="true"><CatIcon /></span>
                <p v-if="message.role === 'user'">{{ message.content }}</p>
                <p v-else-if="isStreamingAssistant(message) && !message.content" class="streaming-placeholder">
                  <span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                  <span>思考中</span>
                </p>
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
                    @click.stop="cancelProcessTask(task)"
                  >
                    取消
                  </button>
                </article>
              </div>
            </div>

            <button v-if="isSteeringDraft" class="active-turn-guide" type="button" @click="submit">
              <CornerDownRightIcon />
              <p>{{ guidancePreview }}</p>
              <span>{{ chat.steeringCount ? `已引导 ${chat.steeringCount}` : '引导' }}</span>
            </button>

            <p v-if="composerError" class="composer-error" role="alert">{{ composerError }}</p>

            <form class="composer-footer" @submit.prevent="submit">
              <div class="ai-input">
                <input
                  ref="fileInputRef"
                  class="file-input"
                  type="file"
                  accept=".txt,.md,.markdown,.json,.csv,text/*,application/json"
                  @change="handleFileSelected"
                />
                <div v-if="attachment" class="attachment-chip">
                  <FileTextIcon />
                  <span>{{ attachment.name }}</span>
                  <button type="button" @click="clearAttachment"><XIcon /></button>
                </div>
                <textarea
                  ref="textareaRef"
                  v-model="draft"
                  rows="1"
                  :placeholder="chat.isSending ? '补充要求，引导当前回答...' : '随心输入'"
                  @focus="syncComposerViewport"
                  @blur="syncComposerViewport"
                  @input="handleComposerInput"
                  @keydown.enter.exact.prevent="submit"
                ></textarea>
                <div class="composer-toolbar">
                  <div class="composer-tools">
                    <button class="composer-icon" type="button" title="导入文件" aria-label="导入文件" @click="fileInputRef?.click()">
                      <PaperclipIcon />
                    </button>
                    <button
                      :class="['thinking-toggle', { active: chat.thinkingEnabled }]"
                      type="button"
                      :aria-pressed="chat.thinkingEnabled"
                      @click="chat.setThinkingEnabled(!chat.thinkingEnabled)"
                    >
                      <BrainIcon />
                      <span>思考</span>
                    </button>
                  </div>
                  <div class="composer-actions">
                    <button
                      v-if="chat.isSending"
                      class="stop-toggle"
                      type="button"
                      title="中断回复"
                      aria-label="中断回复"
                      @click="chat.cancelResponse()"
                    >
                      <SquareIcon />
                    </button>
                    <button
                      v-else
                      class="send-toggle"
                      type="submit"
                      :disabled="!draft.trim() && !attachment"
                      title="发送"
                      aria-label="发送"
                    >
                      <SendIcon />
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </section>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import {
  BrainIcon,
  BookOpenIcon,
  CatIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  ClockIcon,
  CornerDownRightIcon,
  MessageSquareIcon,
  FileTextIcon,
  MonitorIcon,
  NewspaperIcon,
  PaperclipIcon,
  PenToolIcon,
  PlusIcon,
  RotateCcwIcon,
  SendIcon,
  SquareIcon,
  SparklesIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon
} from 'lucide-vue-next';
import { useAIChatStore } from '@/stores/aiChat';
import { useTaskCenterStore } from '@/stores/taskCenter';
import { fileRepository } from '@/services/FileRepository';
import { projectRepository } from '@/services/ProjectRepository';
import {
  agentToolActivityService,
  type AgentToolActivity,
  type AgentToolActivityStatus
} from '@/services/AgentToolActivityService';
import { initializeTutorRuntime } from '@/composition-root/public';
import type { AIMessage } from '@/domain/ai';
import type { AgentRunStatus, AgentRunView } from '@/modules/agent/public';
import MarkdownContent from '@/components/MarkdownContent.vue';

const chat = useAIChatStore();
const taskCenter = useTaskCenterStore();
const { runs: agentRuns } = storeToRefs(taskCenter);
const route = useRoute();
const router = useRouter();
const draft = ref('');
const processOpen = ref(false);
const taskOpen = ref(false);
const sessionMenuOpen = ref(false);
const messageListRef = ref<HTMLElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const attachment = ref<{ name: string; path: string } | null>(null);
const composerError = ref('');
const guidancePreview = ref('');
const toolActivities = ref<readonly AgentToolActivity[]>([]);
const sheetHeight = ref(68);
const layoutViewportHeight = ref(window.innerHeight);
const visualViewportHeight = ref(window.visualViewport?.height ?? window.innerHeight);
const keyboardInset = ref(0);
const dragStartY = ref(0);
const dragStartHeight = ref(68);
const isDragging = ref(false);
const fabPosition = ref(readFabPosition());
const fabDragging = ref(false);
const fabMoved = ref(false);
const fabStart = ref({ x: 0, y: 0, left: 0, top: 0 });
let guidancePreviewTimer: ReturnType<typeof setTimeout> | undefined;

type ProcessStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
type ProcessType = 'generate' | 'grade' | 'essay' | 'digest' | 'study' | 'mock' | 'redo' | 'read';

interface ProcessItem {
  id: string;
  type: ProcessType;
  status: ProcessStatus;
  title: string;
  detail: string;
  progressText: string;
  statusText: string;
  summary: string;
  progress: number;
  canCancel: boolean;
  isActive: boolean;
  isRunningLike: boolean;
  updatedAt: number;
  agentRunId?: AgentRunView['id'];
  actionRoute?: string;
  actionParams?: AgentRunView['actionParams'];
}

onMounted(() => {
  taskCenter.connect();
  void chat.init().catch(() => undefined);
  refreshToolActivities();
  syncViewportMetrics();
  window.addEventListener('resize', syncViewportMetrics);
  window.visualViewport?.addEventListener('resize', syncViewportMetrics);
  window.visualViewport?.addEventListener('scroll', syncViewportMetrics);
  stopToolActivitySubscription = agentToolActivityService.subscribe((activity) => {
    if (!activity || activity.chatSessionId === chat.session?.id) refreshToolActivities();
  });
});

onBeforeUnmount(() => {
  stopResize();
  clearGuidancePreview();
  window.removeEventListener('resize', syncViewportMetrics);
  window.visualViewport?.removeEventListener('resize', syncViewportMetrics);
  window.visualViewport?.removeEventListener('scroll', syncViewportMetrics);
  stopToolActivitySubscription?.();
  taskCenter.disconnect();
});

let stopToolActivitySubscription: (() => void) | undefined;

const taskRows = computed<ProcessItem[]>(() => {
  return agentRuns.value
    .filter((run) => run.targetResourceType !== 'chat_tool')
    .sort((left, right) => Number(right.isActive) - Number(left.isActive) || right.updatedAt - left.updatedAt)
    .slice(0, 2)
    .map(agentRunToProcessItem);
});

const toolRows = computed<ProcessItem[]>(() => {
  return toolActivities.value.map(toolActivityToProcessItem).slice(0, 2);
});

const hasTaskRunning = computed(() => taskRows.value.some((task) => task.isRunningLike));
const hasToolRunning = computed(() => toolRows.value.some((task) => task.isRunningLike));
const hasRunning = computed(() => chat.isSending || hasToolRunning.value || hasTaskRunning.value);
const displayMessages = computed(() => chat.messages.filter((message) => message.role !== 'tool'));
const isSteeringDraft = computed(() => chat.isSending && Boolean(guidancePreview.value));
const isKeyboardOpen = computed(() => keyboardInset.value > 0);
const sheetStyle = computed(() => {
  const requestedHeight = layoutViewportHeight.value * sheetHeight.value / 100;
  const availableHeight = isKeyboardOpen.value
    ? visualViewportHeight.value
    : layoutViewportHeight.value * .92;
  return {
    height: `${Math.min(requestedHeight, availableHeight)}px`,
    maxHeight: `${availableHeight}px`,
    bottom: `${keyboardInset.value}px`
  };
});
const fabStyle = computed(() => ({
  right: '16px',
  top: `${clampFabPosition(fabPosition.value).top}px`
}));

const headerStateText = computed(() => {
  if (chat.isSending) return '正在回复';
  if (hasToolRunning.value) return '正在操作工具';
  if (hasTaskRunning.value) return '任务执行中';
  return '';
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

function agentRunToProcessItem(run: AgentRunView): ProcessItem {
  const status = agentStatusToTaskStatus(run.status);
  return {
    id: `agent-run-${run.id}`,
    type: runTypeToTaskType(run),
    status,
    title: run.title,
    detail: run.detail,
    progressText: run.detail,
    statusText: run.statusText,
    summary: [run.title, run.detail, run.statusText].filter(Boolean).join(' · '),
    progress: run.progress,
    canCancel: run.canCancel,
    isActive: run.isActive,
    isRunningLike: run.isActive,
    updatedAt: run.updatedAt,
    agentRunId: run.id,
    actionRoute: run.actionRoute,
    actionParams: run.actionParams
  };
}

function toolActivityToProcessItem(activity: AgentToolActivity): ProcessItem {
  const parent = agentRuns.value.find((run) => run.id === activity.agentRunId);
  const status = toolActivityProcessStatus(activity.status);
  const detail = [activity.toolName, activity.argumentSummary].filter(Boolean).join(' · ');
  return {
    id: `agent-tool-${activity.agentRunId}-${activity.toolCallId}`,
    type: activity.toolName === 'file.read_text' ? 'read' : runTypeForToolName(activity.toolName),
    status,
    title: activity.label,
    detail,
    progressText: detail,
    statusText: activity.statusText,
    summary: [activity.label, detail, activity.statusText].filter(Boolean).join(' · '),
    progress: status === 'done' ? 100 : status === 'running' ? 50 : 20,
    canCancel: Boolean(parent?.canCancel),
    isActive: activity.status === 'queued' || activity.status === 'running' || activity.status === 'waiting_user',
    isRunningLike: activity.status === 'queued' || activity.status === 'running' || activity.status === 'waiting_user',
    updatedAt: activity.updatedAt,
    agentRunId: activity.agentRunId,
    actionRoute: parent?.actionRoute,
    actionParams: parent?.actionParams
  };
}

function toolActivityProcessStatus(status: AgentToolActivityStatus): ProcessStatus {
  if (status === 'queued') return 'queued';
  if (status === 'running' || status === 'waiting_user') return 'running';
  if (status === 'completed') return 'done';
  return 'failed';
}

function runTypeForToolName(toolName: string): ProcessType {
  if (toolName === 'generate_digest' || toolName === 'generate_monthly_digest') return 'digest';
  if (toolName === 'generate_mock') return 'mock';
  if (toolName === 'generate_essay' || toolName === 'grade_essay') return 'essay';
  if (toolName === 'redo_wrongbook') return 'redo';
  if (toolName === 'student.read_profile' || toolName === 'planning.propose_daily_plan') return 'read';
  return 'generate';
}

function agentStatusToTaskStatus(status: AgentRunStatus): ProcessStatus {
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

function taskIcon(task?: ProcessItem) {
  if (!task) return ClockIcon;
  if (task.status === 'done') return CircleCheckIcon;
  if (task.status === 'failed') return TriangleAlertIcon;
  if (task.type === 'generate') return SparklesIcon;
  if (task.type === 'grade' || task.type === 'essay') return PenToolIcon;
  if (task.type === 'digest') return NewspaperIcon;
  if (task.type === 'study') return BookOpenIcon;
  if (task.type === 'mock') return MonitorIcon;
  if (task.type === 'redo') return RotateCcwIcon;
  if (task.type === 'read') return FileTextIcon;
  return FileTextIcon;
}

function processMetaText(rows: ProcessItem[]): string {
  const first = rows[0];
  if (!first) return '';
  return `${first.statusText} · 1/${rows.length}`;
}

function compactTaskSummary(task: ProcessItem): string {
  return [task.title, taskDetailText(task)].filter(Boolean).join(' · ');
}

function taskDetailText(task: ProcessItem): string {
  return task.detail || task.progressText;
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
  () => chat.isOpen,
  async (isOpen) => {
    if (!isOpen) return;
    syncViewportMetrics();
    await nextTick();
    resizeComposer();
  }
);

watch(draft, async (value) => {
  if (value) return;
  clearGuidancePreview();
  await nextTick();
  resizeComposer();
});

watch(
  () => chat.isSending,
  (isSending) => {
    if (!isSending) {
      clearGuidancePreview();
      return;
    }
    scheduleGuidancePreview();
  }
);

watch(keyboardInset, async () => {
  await nextTick();
  messageListRef.value?.scrollTo({ top: messageListRef.value.scrollHeight });
});

watch(
  () => chat.session?.id,
  () => {
    refreshToolActivities();
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

function resizeComposer() {
  const textarea = textareaRef.value;
  if (!textarea) return;
  const maxHeight = 104;
  textarea.style.height = '32px';
  const nextHeight = Math.min(maxHeight, Math.max(32, textarea.scrollHeight));
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function handleComposerInput() {
  resizeComposer();
  scheduleGuidancePreview();
}

function scheduleGuidancePreview() {
  if (!chat.isSending) return;
  if (guidancePreviewTimer) clearTimeout(guidancePreviewTimer);
  const pending = guidanceDraftText();
  guidancePreview.value = '';
  if (!pending) {
    guidancePreviewTimer = undefined;
    return;
  }
  guidancePreviewTimer = setTimeout(() => {
    guidancePreviewTimer = undefined;
    if (!chat.isSending) return;
    const current = guidanceDraftText();
    if (current !== pending) return;
    guidancePreview.value = compactGuidanceText(current);
  }, 1_000);
}

function clearGuidancePreview() {
  if (guidancePreviewTimer) clearTimeout(guidancePreviewTimer);
  guidancePreviewTimer = undefined;
  guidancePreview.value = '';
}

function guidanceDraftText(): string {
  const text = draft.value.trim();
  if (text) return text;
  return attachment.value ? `导入文件：${attachment.value.name}` : '';
}

function compactGuidanceText(value: string): string {
  return value.length > 60 ? `${value.slice(0, 60)}...` : value;
}

async function cancelProcessTask(task: ProcessItem) {
  if (!task.agentRunId) return;
  const runtime = await initializeTutorRuntime();
  await runtime.cancelAgentRun.execute({
    agentRunId: task.agentRunId,
    reason: 'user_cancelled_from_ai_task_bar'
  });
  await refreshAgentRuns();
}

async function openTask(task: ProcessItem) {
  if (task.actionRoute) {
    const query = Object.fromEntries(
      Object.entries(task.actionParams || {})
        .filter((entry): entry is [string, string | number | boolean] => (
          typeof entry[1] === 'string' || typeof entry[1] === 'number' || typeof entry[1] === 'boolean'
        ))
        .map(([key, value]) => [key, String(value)])
    );
    await router.push({ path: task.actionRoute, query });
    chat.close();
  }
}

async function refreshAgentRuns() {
  await taskCenter.refresh();
}

async function submit() {
  const text = buildPromptWithAttachment(draft.value);
  if (!text.trim()) return;
  if (chat.isSending) {
    try {
      const accepted = await chat.steer(text);
      if (!accepted) return;
      composerError.value = '';
      draft.value = '';
      attachment.value = null;
      clearGuidancePreview();
    } catch (error) {
      composerError.value = chatErrorText(error);
    }
    return;
  }
  const pendingDraft = draft.value;
  const pendingAttachment = attachment.value;
  draft.value = '';
  attachment.value = null;
  sessionMenuOpen.value = false;
  taskOpen.value = false;
  processOpen.value = false;
  composerError.value = '';
  try {
    await chat.send(text);
  } catch (error) {
    draft.value = pendingDraft;
    attachment.value = pendingAttachment;
    composerError.value = chatErrorText(error);
    await nextTick();
    resizeComposer();
  }
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
    path
  };
  scheduleGuidancePreview();
}

function clearAttachment() {
  attachment.value = null;
  scheduleGuidancePreview();
}

function buildPromptWithAttachment(text: string): string {
  const clean = text.trim();
  if (!attachment.value) return clean;
  return [
    clean || '请阅读并分析这个导入文件。',
    '',
    `【已导入本地文件：${attachment.value.name}】`,
    `本地路径：${attachment.value.path}`,
    '请按需调用 file.read_text 读取文件内容。'
  ].join('\n');
}

function refreshToolActivities() {
  toolActivities.value = chat.session?.id
    ? agentToolActivityService.list(chat.session.id)
    : [];
}

function openFromFab() {
  if (fabMoved.value) {
    fabMoved.value = false;
    return;
  }
  void chat.open().catch((error: unknown) => {
    composerError.value = chatErrorText(error);
  });
}

async function newSession() {
  try {
    await chat.newSession();
    composerError.value = '';
    sessionMenuOpen.value = false;
  } catch (error) {
    composerError.value = chatErrorText(error);
  }
}

async function switchSession(sessionId: string) {
  try {
    await chat.switchSession(sessionId);
    composerError.value = '';
    sessionMenuOpen.value = false;
  } catch (error) {
    composerError.value = chatErrorText(error);
  }
}

async function deleteOtherSessions() {
  try {
    await chat.deleteOtherSessions();
    composerError.value = '';
    sessionMenuOpen.value = false;
  } catch (error) {
    composerError.value = chatErrorText(error);
  }
}

function chatErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/not implemented|unimplemented/i.test(message)) return '本地会话组件尚未加载，请重新运行最新版本。';
  if (/network|fetch|连接|网络/i.test(message)) return '模型服务连接失败，请检查网络和 AI 配置。';
  return message.trim() || '操作没有完成，请重试。';
}

function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function syncViewportMetrics() {
  const layoutHeight = window.innerHeight;
  const viewport = window.visualViewport;
  const visibleHeight = viewport?.height ?? layoutHeight;
  const offsetTop = Math.max(0, viewport?.offsetTop ?? 0);
  const possibleKeyboardInset = Math.max(0, layoutHeight - visibleHeight - offsetTop);
  layoutViewportHeight.value = layoutHeight;
  visualViewportHeight.value = visibleHeight;
  keyboardInset.value = possibleKeyboardInset >= 80 ? Math.round(possibleKeyboardInset) : 0;
}

function syncComposerViewport() {
  syncViewportMetrics();
  window.setTimeout(syncViewportMetrics, 80);
  window.setTimeout(syncViewportMetrics, 240);
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
  const routeBottomReserve = Number(route.meta.floatingActionBottom || 0);
  const safeBottom = 12 + (Number.isFinite(routeBottomReserve) ? Math.max(0, routeBottomReserve) : 0);
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
  color: var(--color-brand-strong);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .96), rgba(var(--color-brand-rgb), .22));
  box-shadow: 0 14px 30px rgba(var(--color-brand-rgb), .2);
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
  background: rgba(var(--color-brand-rgb), .16);
  border: 1px solid rgba(var(--color-brand-rgb), .1);
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
  box-shadow: inset 0 0 0 1px rgba(var(--color-brand-rgb), .08);
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
  background: rgba(var(--color-brand-rgb), .22);
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
  transition: height .18s ease, bottom .18s ease, max-height .18s ease;
  touch-action: none;
}

.ai-sheet.keyboard-open {
  min-height: 0;
}

.ai-drag-zone {
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ns-resize;
  flex-shrink: 0;
}

.ai-drag-zone span {
  width: 32px;
  height: 3px;
  border-radius: 999px;
  background: rgba(var(--color-ink-rgb), .1);
}

.ai-header {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 1px 10px 5px;
  border-bottom: none;
}

.session-button {
  min-width: 0;
  max-width: 42%;
  height: 28px;
  border: none;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 3px;
  color: var(--text-color);
  background: transparent;
  font-family: inherit;
}

.session-button strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-medium);
}

.session-button svg {
  width: 12px;
  height: 12px;
  color: var(--text-secondary-color);
  flex-shrink: 0;
}

.ai-header-state {
  flex: 1;
  min-width: 0;
}

.ai-header-state span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-regular);
  opacity: .72;
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
  color: var(--color-brand-strong);
  background: rgba(var(--color-brand-rgb), .12);
}

.thinking-toggle svg {
  width: 14px;
  height: 14px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-secondary-color);
}

.icon-btn svg {
  width: 16px;
  height: 16px;
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
  width: fit-content;
  max-width: calc(100% - 24px);
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
  color: var(--color-brand);
}

.empty-cat {
  width: 52px;
  height: 46px;
  border-radius: 18px 18px 16px 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-brand-strong);
  background: linear-gradient(180deg, rgba(255, 255, 255, .94), rgba(var(--color-brand-rgb), .18));
  box-shadow: 0 10px 24px rgba(var(--color-brand-rgb), .16);
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
  color: var(--color-brand-strong);
  background: rgba(var(--color-brand-rgb), .13);
}

.message-cat svg {
  width: 15px;
  height: 15px;
}

.message.pending {
  color: var(--text-secondary-color);
}

.streaming-placeholder {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary-color);
}

.thinking-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.thinking-dots i {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--color-brand);
  animation: thinkingDot 1.1s ease-in-out infinite;
}

.thinking-dots i:nth-child(2) {
  animation-delay: .14s;
}

.thinking-dots i:nth-child(3) {
  animation-delay: .28s;
}


.active-turn-guide {
  width: calc(100% - 24px);
  min-height: 32px;
  margin: 3px 12px 0;
  padding: 5px 9px;
  border: 1px solid rgba(var(--color-ink-rgb), .05);
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-secondary-color);
  background: rgba(255, 255, 255, .6);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  text-align: left;
}

.active-turn-guide > svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.active-turn-guide p {
  min-width: 0;
  flex: 1;
  margin: 0;
  overflow: hidden;
  color: var(--text-color);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--type-size-caption);
}

.active-turn-guide span {
  flex-shrink: 0;
  color: #9a6208;
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.composer-error {
  margin: 3px 16px 5px;
  color: var(--red-color);
  font-size: var(--type-size-micro);
  line-height: 1.4;
  text-align: left;
}

.composer-footer {
  --composer-bottom-blend: calc(10px + max(0px, calc(var(--app-safe-bottom) - 17px)));
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  padding: 0 9px var(--composer-bottom-blend);
}

.ai-sheet.keyboard-open .composer-footer {
  --composer-bottom-blend: 8px;
}

.composer-footer::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  z-index: 0;
  height: var(--composer-bottom-blend);
  pointer-events: none;
  background: linear-gradient(180deg, rgba(248, 250, 253, 0), rgba(248, 250, 253, .96));
}

.ai-input {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding: 6px 7px;
  border: 0;
  border-radius: 18px;
  background:
    linear-gradient(
      180deg,
      rgba(255, 255, 255, .78) 0%,
      rgba(255, 255, 255, .56) 68%,
      rgba(248, 250, 253, 0) 100%
    );
  box-shadow:
    inset 0 1px 0 rgba(var(--color-ink-rgb), .045),
    0 -4px 16px rgba(15, 23, 42, .025);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.file-input {
  display: none;
}

.attachment-chip {
  width: fit-content;
  max-width: 100%;
  min-height: 30px;
  padding: 0 7px 0 9px;
  border: none;
  border-radius: 9px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-color);
  background: rgba(var(--color-ink-rgb), .055);
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
  width: 100%;
  height: 32px;
  min-height: 32px;
  max-height: 104px;
  padding: 5px 7px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--text-color);
  font: inherit;
  line-height: 1.35;
  overflow-y: hidden;
}

.ai-input textarea::placeholder {
  color: rgba(var(--color-ink-rgb), .34);
}

.composer-toolbar,
.composer-tools,
.composer-actions {
  display: flex;
  align-items: center;
}

.composer-toolbar {
  min-height: 32px;
  justify-content: space-between;
  gap: 8px;
}

.composer-tools,
.composer-actions {
  gap: 5px;
}

.composer-icon,
.stop-toggle,
.send-toggle {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.composer-icon {
  color: var(--text-secondary-color);
  background: transparent;
}

.composer-icon svg {
  width: 18px;
  height: 18px;
}

.composer-tools .thinking-toggle {
  height: 32px;
  padding: 0 9px;
  border-radius: 12px;
  background: transparent;
}

.ai-input button.send-toggle {
  color: #fff;
  background: var(--primary-color);
}

.stop-toggle {
  color: #fff;
  background: var(--red-color);
  box-shadow: 0 6px 16px rgba(255, 59, 48, .18);
}

.ai-input button[type="submit"]:disabled,
.ai-input button[type="button"]:disabled {
  opacity: .45;
}

.ai-input button[type="submit"] svg,
.ai-input button.send-toggle svg,
.stop-toggle svg {
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

@keyframes thinkingDot {
  0%, 60%, 100% { transform: translateY(0); opacity: .38; }
  30% { transform: translateY(-3px); opacity: 1; }
}

@keyframes aiFabPulse {
  0%, 100% { transform: scale(1); box-shadow: 0 14px 30px rgba(var(--color-brand-rgb), .26); }
  50% { transform: scale(1.04); box-shadow: 0 16px 36px rgba(var(--color-brand-rgb), .4); }
}

@keyframes catThinking {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(-2px) rotate(-4deg); }
  50% { transform: translateY(0) rotate(0deg); }
  75% { transform: translateY(-1px) rotate(4deg); }
}
</style>
