<template>
  <div class="essay-page app-page">
    <PageHeader class="essay-header" :title="essayHeaderTitle">
      <template #meta>
        <div class="essay-header-meta">
          <span>{{ essaySessionMeta }}</span>
          <button
            v-if="activeMode === 'question' && store.question && !store.submission.feedback"
            :class="['essay-session-timer', { running: isTimerRunning }]"
            type="button"
            title="暂停或继续计时"
            @click="toggleTimer"
          >
            <Clock3Icon />{{ elapsedText }}
          </button>
        </div>
      </template>
      <template #actions>
        <HeaderMoreMenu title="题目操作" subtitle="当前题目与作答">
          <button class="menu-row" type="button" @click="openQuestionHistory">
            <FileClockIcon />
            历史题目
          </button>
          <button class="menu-row" type="button" @click="showHistorySheet = true">
            <HistoryIcon />
            本题批改记录
          </button>
          <button class="menu-row danger" type="button" @click="deleteCurrentEssay">
            <Trash2Icon />
            删除当前
          </button>
        </HeaderMoreMenu>
      </template>
    </PageHeader>

    <div v-if="store.isLoading" class="loading">加载题目中...</div>

    <div v-else-if="store.question" :class="['content-area', 'app-page-scroll', { 'with-start-bar': activeMode === 'question' }]">
      <div class="mode-tabs">
        <button type="button" :class="{ active: activeMode === 'lecture' }" @click="activeMode = 'lecture'">讲义</button>
        <button type="button" :class="{ active: activeMode === 'question' }" @click="activeMode = 'question'">题目</button>
      </div>

      <section v-if="activeMode === 'lecture'" class="lecture-section">
        <div class="lecture-head">
          <span>{{ activeTopic }} · {{ lecture.knowledgePoint || '知识点讲义' }}</span>
          <h4>{{ lecture.title }}</h4>
          <p>{{ lecture.summary }}</p>
        </div>
        <div class="lecture-grid">
          <article v-for="section in lectureSections" :key="section.title">
            <strong>{{ section.title }}</strong>
            <em v-for="(item, index) in section.items" :key="`${section.title}:${index}`">{{ item }}</em>
          </article>
        </div>
      </section>

      <template v-else>
        <div class="question-section">
          <div class="question-meta">
            <span>{{ activeTopic }}</span>
            <em>{{ store.context?.date }}</em>
          </div>
          <h4>{{ store.question.title }}</h4>
          <div class="material-block">
            <strong>给定资料</strong>
            <p v-for="(paragraph, index) in materialParagraphs" :key="index">{{ paragraph }}</p>
          </div>
          <div class="requirement-block">
            <strong>作答任务</strong>
            <ol v-if="requirementTasks.length > 1">
              <li v-for="task in requirementTasks" :key="task">{{ task }}</li>
            </ol>
            <p v-else>{{ store.question.requirement }}</p>
          </div>
        </div>

        <div v-if="store.submission.isSubmitting" class="feedback-loading">
          <span class="loading-dot"></span>
          正在提交批改任务...
        </div>

        <div v-if="store.submitMessage" class="submit-message">
          {{ store.submitMessage }}
        </div>

        <div v-if="store.submission.feedback" class="feedback-section">
          <h4>AI 批改反馈</h4>
          <MarkdownContent :content="store.submission.feedback" />
        </div>
      </template>

      <section v-if="store.history.length" class="history-section">
        <div class="history-title">
          <strong>最近批改</strong>
          <span>最多 10 条</span>
        </div>
        <article v-for="item in store.history.slice(0, 3)" :key="item.id" class="history-row">
          <div>
            <strong>{{ item.title }}</strong>
            <span>{{ formatTime(item.createdAt) }} · {{ item.wordCount }} 字<span v-if="item.score"> · {{ item.score }}分</span></span>
          </div>
          <ul v-if="item.dimensions?.length" class="dimension-list">
            <li v-for="(dimension, index) in item.dimensions" :key="`${dimension.name}:${index}`">
              <b>{{ dimension.name }}</b>
              <em v-if="dimension.score !== undefined">{{ dimension.score }}</em>
              <span>{{ dimension.comment }}</span>
            </li>
          </ul>
          <MarkdownContent class="history-feedback" :content="item.feedback" />
        </article>
      </section>
    </div>

    <section v-else class="essay-empty app-page-scroll">
      <strong>暂无申论题目</strong>
      <p>请返回刷题中心，从私教学习、自主刷题或真题练习入口开始。</p>
    </section>

    <div v-if="store.question && activeMode === 'question' && !isAnswerSheetOpen" class="essay-start-bar">
      <button type="button" @click="openAnswerSheet">
        <Edit3Icon />
        {{ store.submission.content ? '继续作答' : '开始作答' }}
      </button>
    </div>

    <Transition name="answer-backdrop">
      <button v-if="isAnswerSheetOpen" class="answer-backdrop" type="button" aria-label="收起作答区" @click="isAnswerSheetOpen = false"></button>
    </Transition>
    <Transition name="answer-sheet">
      <section
        v-if="isAnswerSheetOpen"
        :class="['answer-sheet', { long: isLongEssay }]"
        :style="{ height: `${answerSheetHeight}dvh` }"
      >
        <div
          class="answer-handle"
          @pointerdown="startAnswerResize"
        ></div>
        <header class="answer-sheet-head">
          <div>
            <span class="answer-dot"></span>
            <strong>作答区</strong>
          </div>
          <button type="button" aria-label="收起作答区" @click="isAnswerSheetOpen = false">
            <ChevronDownIcon />
          </button>
        </header>
        <textarea
          :value="store.submission.content"
          @input="updateContent"
          placeholder="在此处输入你的申论答案..."
          class="answer-textarea"
        ></textarea>
        <footer class="answer-sheet-foot">
          <span>{{ wordCount }} 字</span>
          <button class="ghost" type="button" @click="store.resetDraft">清空</button>
          <button class="ghost" type="button" @click="isAnswerSheetOpen = false">收起</button>
          <button class="primary" type="button" :disabled="store.submission.isSubmitting || !store.submission.content" @click="store.submitForGrading">
            {{ store.submission.isSubmitting ? '批改中...' : '提交批改' }}
          </button>
        </footer>
      </section>
    </Transition>

    <BottomSheet v-model="showHistorySheet" title="历史批改" subtitle="最近 10 条记录" variant="actions">
      <div v-if="store.history.length" class="essay-history-list">
        <button v-for="item in store.history" :key="item.id" type="button" @click="openHistoryItem(item)">
          <span>{{ item.title }}</span>
          <em>{{ formatTime(item.createdAt) }} · {{ item.wordCount }} 字<span v-if="item.score"> · {{ item.score }}分</span></em>
        </button>
      </div>
      <div v-else class="sheet-empty">暂无历史批改</div>
    </BottomSheet>

    <BottomSheet v-model="showQuestionHistorySheet" title="历史题目" subtitle="按题型和日期选择" variant="actions">
      <InfiniteScrollPagination :has-more="questionHistoryVisibleCount < questionHistory.length" :has-items="Boolean(questionHistory.length)" :on-load-more="loadMoreQuestionHistory">
        <div v-if="questionHistory.length" class="essay-history-list">
          <button v-for="item in visibleQuestionHistory" :key="item.key" type="button" @click="openQuestionHistoryItem(item)"><span>{{ item.state.question?.title }}</span><em>{{ item.context.date }} · {{ item.context.topic }}</em>
          </button>
        </div>
      </InfiniteScrollPagination>
      <div v-if="!questionHistory.length" class="sheet-empty">暂无历史题目</div>
    </BottomSheet>

    <ConfirmDialog
      v-model="showDeleteConfirmSheet"
      title="删除当前申论"
      description="题目、草稿和本题批改记录都会清除。"
      confirm-text="确认删除"
      tone="danger"
      @confirm="confirmDeleteCurrentEssay"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronDownIcon, Clock3Icon, Edit3Icon, FileClockIcon, HistoryIcon, Trash2Icon } from 'lucide-vue-next';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import ConfirmDialog from '@/components/layout/ConfirmDialog.vue';
import HeaderMoreMenu from '@/components/layout/HeaderMoreMenu.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import MarkdownContent from '@/components/MarkdownContent.vue';
import { InfiniteScrollPagination } from '@/capabilities/design-system/public';
import type { EssayHistoryRecord, EssayLecture, EssayStateHistoryItem } from '@/services/EssayRepository';
import { essayRepository } from '@/services/EssayRepository';
import { useEssayStore } from '@/stores/essay';
import { essayFlowService } from '@/services/EssayFlowService';
import {
  essayCenterLocation,
  essayQuestionSetLocation,
  essayQuestionSetTargetFromQuery
} from '@/features/practice/EssayNavigation';

const store = useEssayStore();
const route = useRoute();
const router = useRouter();
const activeMode = ref<'lecture' | 'question'>('lecture');
const isAnswerSheetOpen = ref(false);
const showHistorySheet = ref(false);
const showQuestionHistorySheet = ref(false);
const showDeleteConfirmSheet = ref(false);
const questionHistory = ref<EssayStateHistoryItem[]>([]); const questionHistoryVisibleCount = ref(20);
const visibleQuestionHistory = computed(() => questionHistory.value.slice(0, questionHistoryVisibleCount.value));
const answerSheetHeight = ref(42);
const elapsedMs = ref(0);
const isTimerRunning = ref(false);
let timerId: number | null = null;
let resizeStartY = 0;
let resizeStartHeight = 0;

onMounted(async () => {
  const target = essayQuestionSetTargetFromQuery(route.query);
  if (!target) {
    await router.replace(essayCenterLocation());
    return;
  }
  const routeContext = essayFlowService.writeContext({
    ...target
  });
  await store.fetchQuestion(routeContext);
  restoreTimer();
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('pointermove', resizeAnswerSheet);
  saveTimer();
  stopTimer();
});

const updateContent = (event: Event) => {
  const target = event.target as HTMLTextAreaElement;
  store.updateContent(target.value);
};

const wordCount = computed(() => store.submission.content.length);
const activeTopic = computed(() => store.context?.topic || '申论练习');
const essayHeaderTitle = computed(() => `申论 · ${activeTopic.value}`);
const essaySessionMeta = computed(() => {
  const mode = store.context?.entryMode === 'tutor'
    ? '私教训练'
    : store.context?.entryMode === 'true'
      ? '真题练习'
      : '自主刷题';
  if (activeMode.value === 'lecture') return `${mode} · 配套讲义`;
  if (store.submission.feedback) return `${mode} · 批改结果`;
  return `${mode} · ${store.submission.content ? '继续作答' : '未作答'}`;
});
const isLongEssay = computed(() => store.context?.type === 'long' || activeTopic.value === '申发论述');
const lecture = computed<EssayLecture>(() => store.question?.lecture || {
  knowledgePoint: activeTopic.value,
  title: '暂无知识点讲义',
  summary: '生成申论练习后，会同时生成一份围绕细分知识点的学习讲义，并让题目材料和作答要求服务于这个训练目标。',
  clues: [],
  methods: [],
  structure: [],
  warnings: [],
  cases: [],
  drills: []
});
const lectureSections = computed(() => [
  { title: '审题抓手', items: lecture.value.clues },
  { title: '核心方法', items: lecture.value.methods },
  { title: '作答结构', items: lecture.value.structure },
  { title: '易错提醒', items: lecture.value.warnings },
  { title: '规范表达', items: lecture.value.cases },
  { title: '训练任务', items: lecture.value.drills }
].filter((section) => section.items.length > 0));
const elapsedText = computed(() => formatDuration(elapsedMs.value));
const materialParagraphs = computed(() => splitMaterial(store.question?.material || ''));
const requirementTasks = computed(() => splitRequirement(store.question?.requirement || ''));

async function deleteCurrentEssay() {
  showDeleteConfirmSheet.value = true;
}

async function confirmDeleteCurrentEssay() {
  showDeleteConfirmSheet.value = false;
  isAnswerSheetOpen.value = false;
  activeMode.value = 'lecture';
  resetTimer();
  const state = await essayRepository.deleteState(store.context || essayFlowService.readContext());
  store.question = state.question;
  store.submission.content = state.draft;
  store.submission.feedback = state.feedback;
  store.history = state.history;
}

function openHistoryItem(item: EssayHistoryRecord) {
  showHistorySheet.value = false;
  activeMode.value = 'question';
  store.submission.content = item.content;
  store.submission.feedback = item.feedback;
}

async function openQuestionHistory() {
  questionHistory.value = await essayRepository.listStates(); questionHistoryVisibleCount.value = 20; showQuestionHistorySheet.value = true;
}
function loadMoreQuestionHistory() { questionHistoryVisibleCount.value = Math.min(questionHistory.value.length, questionHistoryVisibleCount.value + 20); }
async function openQuestionHistoryItem(item: EssayStateHistoryItem) {
  showQuestionHistorySheet.value = false;
  isAnswerSheetOpen.value = false;
  activeMode.value = 'lecture';
  const context = essayFlowService.writeContext(item.context);
  resetTimer();
  await store.fetchQuestion(context);
  await router.replace(essayQuestionSetLocation({
    questionSetId: context.questionSetId || item.key,
    entryMode: context.entryMode,
    date: context.date,
    topic: context.topic,
    type: context.type
  }));
}

function openAnswerSheet() {
  activeMode.value = 'question';
  answerSheetHeight.value = isLongEssay.value ? 62 : 42;
  isAnswerSheetOpen.value = true;
  startTimer();
}

function startAnswerResize(event: PointerEvent) {
  resizeStartY = event.clientY;
  resizeStartHeight = answerSheetHeight.value;
  window.addEventListener('pointermove', resizeAnswerSheet);
  window.addEventListener('pointerup', stopAnswerResize, { once: true });
}

function resizeAnswerSheet(event: PointerEvent) {
  const deltaVh = ((resizeStartY - event.clientY) / window.innerHeight) * 100;
  const min = isLongEssay.value ? 48 : 34;
  const max = isLongEssay.value ? 78 : 62;
  answerSheetHeight.value = Math.min(max, Math.max(min, resizeStartHeight + deltaVh));
}

function stopAnswerResize() {
  window.removeEventListener('pointermove', resizeAnswerSheet);
}

function formatTime(time: number): string {
  return new Date(time).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function splitMaterial(material: string): string[] {
  const clean = material.trim();
  if (!clean) return [];
  const normalized = clean.replace(/^给定资料[:：]\s*/u, '');
  return normalized
    .split(/\n{2,}|(?=材料[一二三四五六七八九十\d]+[:：])|(?=资料[一二三四五六七八九十\d]+[:：])/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitRequirement(requirement: string): string[] {
  const clean = requirement.trim().replace(/^要求[:：]\s*/u, '');
  if (!clean) return [];
  const parts = clean
    .split(/(?:\n+|(?=[（(]?\d+[）).、])|(?=[一二三四五六七八九十]+[、.．]))/u)
    .map((item) => item.replace(/^[（(]?\d+[）).、]\s*/u, '').replace(/^[一二三四五六七八九十]+[、.．]\s*/u, '').trim())
    .filter(Boolean);
  return parts.length ? parts : [clean];
}

function timerKey() {
  const context = store.context || essayFlowService.readContext();
  return `essay-timer:${context.questionSetId || `${context.topic}:${context.date}`}`;
}

function restoreTimer() {
  try {
    const raw = localStorage.getItem(timerKey());
    if (!raw) return;
    const saved = JSON.parse(raw) as { elapsedMs?: number; running?: boolean; savedAt?: number };
    elapsedMs.value = saved.elapsedMs || 0;
    if (saved.running && saved.savedAt) {
      elapsedMs.value += Date.now() - saved.savedAt;
      startTimer();
    }
  } catch {
    elapsedMs.value = 0;
  }
}

function saveTimer() {
  if (!store.context) return;
  localStorage.setItem(timerKey(), JSON.stringify({
    elapsedMs: elapsedMs.value,
    running: isTimerRunning.value,
    savedAt: Date.now()
  }));
}

function startTimer() {
  if (timerId !== null) return;
  isTimerRunning.value = true;
  const startedAt = Date.now() - elapsedMs.value;
  timerId = window.setInterval(() => {
    elapsedMs.value = Date.now() - startedAt;
    if (Math.floor(elapsedMs.value / 1000) % 10 === 0) saveTimer();
  }, 1000);
  saveTimer();
}

function stopTimer() {
  if (timerId !== null) {
    window.clearInterval(timerId);
    timerId = null;
  }
  isTimerRunning.value = false;
}

function toggleTimer() {
  if (isTimerRunning.value) {
    stopTimer();
    saveTimer();
  } else {
    startTimer();
  }
}

function resetTimer() {
  stopTimer();
  elapsedMs.value = 0;
  try {
    localStorage.removeItem(timerKey());
  } catch {
    // ignore storage failures
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    saveTimer();
    stopTimer();
  } else {
    restoreTimer();
  }
}

</script>

<style scoped>
.essay-header-meta {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
}
.essay-header-meta > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.essay-session-timer {
  flex: 0 0 auto;
  height: 19px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: none;
  border-radius: 999px;
  padding: 0 6px;
  background: rgba(var(--color-ink-rgb), .045);
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
  font-variant-numeric: tabular-nums;
  font-family: inherit;
}
.essay-session-timer.running {
  background: rgba(var(--color-brand-rgb), .1);
  color: var(--primary-color);
}
.essay-session-timer svg { width: 12px; height: 12px; }
.essay-empty { min-height: 320px; display: grid; place-content: center; gap: 8px; padding: 30px 18px; text-align: center; color: var(--text-secondary-color); }
.essay-empty strong { color: var(--text-color); font-size: var(--type-size-title); }
.essay-empty p { margin: 0; line-height: 1.6; }
.content-area {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 10px;
}
.content-area.with-start-bar {
  padding-bottom: 78px;
}
.mode-tabs {
  padding: 3px;
  border-radius: 11px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
  background: rgba(var(--color-ink-rgb), .06);
  flex-shrink: 0;
}
.mode-tabs button {
  height: 32px;
  border: none;
  border-radius: 9px;
  color: var(--text-secondary-color);
  background: transparent;
  font-family: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
.mode-tabs button.active {
  color: var(--primary-color);
  background: rgba(255, 255, 255, .9);
  box-shadow: 0 1px 5px rgba(28, 38, 58, .08);
}
.lecture-section {
  padding: 13px;
  border-radius: 14px;
  background: rgba(255,255,255,.82);
  border: 1px solid rgba(var(--color-ink-rgb), .06);
  box-shadow: 0 10px 26px rgba(28,38,58,.06);
}
.lecture-head {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.lecture-head span {
  color: var(--primary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.lecture-head h4 {
  margin: 0;
  color: var(--text-color);
  font-size: var(--type-size-control);
}
.lecture-head p {
  margin: 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  line-height: 1.6;
}
.lecture-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.lecture-grid article {
  padding: 10px 11px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  background: rgba(var(--color-ink-rgb), .045);
}
.lecture-grid strong {
  color: var(--text-color);
  font-size: var(--type-size-secondary);
}
.lecture-grid em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-style: normal;
  line-height: 1.48;
}
.start-answer-btn {
  width: 100%;
  min-height: 42px;
  margin-top: 14px;
  border: none;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  background: var(--primary-color);
  color: #fff;
  font-family: inherit;
  font-size: var(--type-size-body);
  font-weight: var(--type-weight-semibold);
}
.start-answer-btn svg {
  width: 16px;
  height: 16px;
}
.question-section {
  margin: 0;
  padding: 13px 14px;
  border-radius: 14px;
  background: rgba(255,255,255,.84);
  border: 1px solid rgba(var(--color-ink-rgb), .06);
  box-shadow: 0 10px 26px rgba(28,38,58,.07);
}
.question-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.question-meta span {
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(var(--color-brand-rgb), .1);
  color: var(--primary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.question-meta em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}
.question-section h4 {
  margin: 0 0 8px;
  line-height: 1.42;
  font-size: var(--type-size-body-large);
}
.material-block,
.requirement-block {
  margin-top: 10px;
  padding: 11px;
  border-radius: 12px;
  background: rgba(245, 246, 250, .72);
}
.material-block strong,
.requirement-block strong {
  display: block;
  margin-bottom: 7px;
  color: var(--text-color);
  font-size: var(--type-size-secondary);
}
.material-block p,
.requirement-block p,
.requirement-block li {
  margin: 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-body);
  line-height: 1.72;
}
.material-block p + p {
  margin-top: 9px;
  padding-top: 9px;
  border-top: 1px dashed rgba(var(--color-ink-rgb), .08);
}
.requirement-block ol {
  margin: 0;
  padding-left: 18px;
}
.requirement-block li + li {
  margin-top: 6px;
}
.feedback-loading { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 18px; font-size: var(--type-size-body-large); color: var(--primary-color); }
.submit-message { margin-top: 14px; padding: 12px 14px; border-radius: 13px; background: rgba(var(--color-brand-rgb), .1); color: var(--primary-color); font-size: var(--type-size-secondary); font-weight: var(--type-weight-semibold); }
.loading-dot { width: 9px; height: 9px; border-radius: 999px; background: var(--primary-color); animation: essayPulse 1s ease-in-out infinite; }
.feedback-section { margin-top: 16px; padding: 16px; background: var(--soft-blue); border-radius: 14px; line-height: 1.7; }
.feedback-section h4 { margin: 0 0 8px; }
.feedback-section :deep(p) { margin: 0; }
.history-section { margin-top: 16px; padding: 14px; border: 1px solid rgba(var(--color-ink-rgb), .06); border-radius: 14px; background: rgba(255,255,255,.82); box-shadow: 0 10px 26px rgba(28,38,58,.06); }
.history-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.history-title strong { font-size: var(--type-size-body-large); }
.history-title span { color: var(--text-secondary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); }
.history-row { padding: 10px 0; border-top: 1px solid rgba(var(--color-ink-rgb), .06); }
.history-row:first-of-type { border-top: none; padding-top: 0; }
.history-row div { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.history-row strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--type-size-secondary); }
.history-row span { flex-shrink: 0; color: var(--text-secondary-color); font-size: var(--type-size-micro); }
.history-feedback { margin: 6px 0 0; color: var(--text-secondary-color); font-size: var(--type-size-caption); line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.dimension-list { display: flex; flex-direction: column; gap: 5px; margin: 8px 0 0; padding: 0; list-style: none; }
.dimension-list li { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 6px; align-items: center; color: var(--text-secondary-color); font-size: var(--type-size-micro); }
.dimension-list b { color: var(--text-color); }
.dimension-list em { font-style: normal; color: var(--primary-color); font-weight: var(--type-weight-semibold); }
.dimension-list span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.essay-start-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  padding: 8px var(--page-x) calc(8px + env(safe-area-inset-bottom));
  background:
    linear-gradient(180deg, rgba(247, 249, 252, 0), rgba(247, 249, 252, .94) 22%, rgba(247, 249, 252, .98));
  box-shadow: 0 -10px 24px rgba(28,38,58,.06);
}
.essay-start-bar button {
  width: 100%;
  height: 50px;
  border: none;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--primary-color);
  color: #fff;
  font-family: inherit;
  font-size: var(--type-size-control);
  font-weight: var(--type-weight-semibold);
  box-shadow: 0 8px 18px rgba(var(--color-brand-rgb), .18);
}
.essay-start-bar svg {
  width: 18px;
  height: 18px;
}
.answer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  border: none;
  background: rgba(15, 23, 42, .34);
  padding: 0;
}
.answer-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 71;
  border-radius: 18px 18px 0 0;
  display: flex;
  flex-direction: column;
  background: var(--app-sheet-bg);
  box-shadow: 0 -18px 50px rgba(15, 23, 42, .24);
  overflow: hidden;
}
.answer-handle {
  display: flex;
  justify-content: center;
  padding: 11px 0 6px;
  flex-shrink: 0;
  touch-action: none;
  cursor: ns-resize;
}
.answer-handle::after {
  content: '';
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: rgba(var(--color-ink-rgb), .16);
}
.answer-sheet-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 14px 10px;
}
.answer-sheet-head div {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.answer-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--primary-color);
}
.answer-sheet-head strong {
  color: var(--text-color);
  font-size: var(--type-size-body);
}
.answer-sheet-head button {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--color-ink-rgb), .06);
  color: var(--text-secondary-color);
}
.answer-sheet-head svg {
  width: 17px;
  height: 17px;
}
.answer-textarea {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: none;
  outline: none;
  padding: 2px 16px 10px;
  background: transparent;
  color: var(--text-color);
  font-family: inherit;
  font-size: var(--type-size-body-large);
  line-height: 1.85;
  resize: none;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.answer-sheet.long .answer-textarea {
  font-size: var(--type-size-control);
  line-height: 1.9;
}
.answer-sheet-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px calc(9px + env(safe-area-inset-bottom));
  border-top: 1px solid rgba(var(--color-ink-rgb), .06);
}
.answer-sheet-foot span {
  min-width: 44px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.answer-sheet-foot button {
  height: 38px;
  border: none;
  border-radius: 10px;
  padding: 0 13px;
  font-family: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
.answer-sheet-foot .ghost {
  background: rgba(var(--color-ink-rgb), .06);
  color: var(--text-secondary-color);
}
.answer-sheet-foot .primary {
  flex: 1;
  background: var(--primary-color);
  color: #fff;
}
.answer-sheet-foot .primary:disabled {
  opacity: .48;
}
.essay-history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.essay-history-list button {
  width: 100%;
  min-height: 52px;
  border: none;
  border-radius: 13px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 8px 12px;
  background: rgba(255,255,255,.74);
  color: var(--text-color);
  font-family: inherit;
  text-align: left;
}
.essay-history-list span,
.essay-history-list em {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.essay-history-list span {
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
.essay-history-list em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}
.sheet-empty {
  padding: 26px 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
  text-align: center;
}
.answer-backdrop-enter-active,
.answer-backdrop-leave-active {
  transition: opacity .18s ease;
}
.answer-backdrop-enter-from,
.answer-backdrop-leave-to {
  opacity: 0;
}
.answer-sheet-enter-active,
.answer-sheet-leave-active {
  transition: transform .22s ease;
}
.answer-sheet-enter-from,
.answer-sheet-leave-to {
  transform: translateY(100%);
}
@keyframes essayPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .45; transform: scale(1.35); } }
</style>
