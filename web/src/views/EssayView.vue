<template>
  <div class="essay-page app-page">
    <PageHeader class="essay-header" :title="essayHeaderTitle">
      <template #meta>
        <div class="essay-header-meta">
          <span>{{ essaySessionMeta }}</span>
          <button
            v-if="activeMode === 'question' && store.question"
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

    <nav v-if="store.question && hasLecture" class="essay-tabs" aria-label="学习内容切换">
      <button type="button" :class="{ active: activeMode === 'lecture' }" @click="activeMode = 'lecture'">讲义</button>
      <button type="button" :class="{ active: activeMode === 'question' }" @click="activeMode = 'question'">题目</button>
    </nav>

    <p v-if="gradingStatusText" class="essay-status" role="status">
      <LoaderCircleIcon />{{ gradingStatusText }}
    </p>
    <p v-else-if="pageAlert" class="essay-alert" role="alert">{{ pageAlert }}</p>

    <div v-if="store.isLoading" class="app-page-scroll essay-loading" aria-busy="true">
      <div class="essay-loading-block" aria-hidden="true"></div>
      <p class="essay-loading-label">正在读取申论题目...</p>
    </div>

    <section v-else-if="store.error && !store.question" class="essay-empty app-page-scroll">
      <strong>题目加载失败</strong>
      <p>{{ store.error }}</p>
      <button class="essay-retry" type="button" @click="reload">重试</button>
    </section>

    <div v-else-if="store.question" class="content-area app-page-scroll">
      <section v-if="activeMode === 'lecture' && activeLecture" class="lecture-section">
        <div class="lecture-head">
          <span>{{ activeTopic }} · {{ activeLecture.knowledgePoint || '知识点讲义' }}</span>
          <h4>{{ activeLecture.title }}</h4>
          <p>{{ activeLecture.summary }}</p>
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
            <b v-if="hasWordBudget">{{ wordBudgetLabel }}</b>
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

        <section v-if="store.preview" class="attempt-preview">
          <header>
            <div>
              <strong>历史批改</strong>
              <span>{{ formatTime(store.preview.createdAt) }} · {{ countEssayWords(store.preview.content) }} 字</span>
            </div>
            <button type="button" @click="store.closePreview()">返回当前作答</button>
          </header>
          <div class="attempt-preview-answer">
            <strong>当时的作答</strong>
            <p>{{ store.preview.content }}</p>
          </div>
          <MarkdownContent :content="store.preview.feedback" />
        </section>

        <template v-else>
          <div v-if="store.submission.feedback" class="feedback-section">
            <h4>AI 批改反馈</h4>
            <MarkdownContent :content="store.submission.feedback" />
          </div>
        </template>
      </template>

      <section v-if="store.history.length" class="history-section">
        <div class="history-title">
          <strong>最近批改</strong>
          <span>{{ historyCountLabel }}</span>
        </div>
        <article v-for="item in visibleHistory" :key="item.id" class="history-row">
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

    <StickyActionBar v-if="store.question && activeMode === 'question' && !isAnswerSheetOpen">
      <button class="primary essay-start-button" type="button" @click="openAnswerSheet">
        <Edit3Icon />
        {{ store.submission.content ? '继续作答' : '开始作答' }}
      </button>
    </StickyActionBar>

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
          <span :class="['answer-word-count', wordCount.tone]">{{ wordCount.label }}</span>
          <button class="ghost" type="button" @click="store.resetDraft">清空</button>
          <button class="ghost" type="button" @click="isAnswerSheetOpen = false">收起</button>
          <button class="primary" type="button" :disabled="store.submission.isSubmitting || !store.submission.content" @click="submitForGrading">
            {{ store.submission.isSubmitting ? '提交中...' : '提交批改' }}
          </button>
        </footer>
      </section>
    </Transition>

    <BottomSheet v-model="showHistorySheet" title="历史批改" :subtitle="`共 ${store.history.length} 条`" variant="actions">
      <div v-if="store.history.length" class="essay-history-list">
        <button v-for="item in store.history" :key="item.id" type="button" @click="openHistoryItem(item)">
          <span>{{ item.title }}</span>
          <em>{{ formatTime(item.createdAt) }} · {{ item.wordCount }} 字<span v-if="item.score"> · {{ item.score }}分</span></em>
        </button>
      </div>
      <div v-else class="sheet-empty">暂无历史批改</div>
    </BottomSheet>

    <BottomSheet v-model="showQuestionHistorySheet" title="历史题目" :subtitle="`共 ${questionHistoryTotal} 套`" variant="actions">
      <InfiniteScrollPagination :has-more="questionHistoryHasMore" :has-items="Boolean(questionHistory.length)" :on-load-more="loadMoreQuestionHistory">
        <div v-if="questionHistory.length" class="essay-history-list">
          <button v-for="item in questionHistory" :key="item.key" type="button" @click="openQuestionHistoryItem(item)"><span>{{ item.question?.title }}</span><em>{{ item.classification === 'legacy_unknown' ? '历史未分类 · ' : '' }}{{ item.context.date }} · {{ item.context.topic }}</em>
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
import { onMounted, onUnmounted, computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronDownIcon, Clock3Icon, Edit3Icon, FileClockIcon, HistoryIcon, LoaderCircleIcon, Trash2Icon } from 'lucide-vue-next';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import ConfirmDialog from '@/components/layout/ConfirmDialog.vue';
import HeaderMoreMenu from '@/components/layout/HeaderMoreMenu.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import MarkdownContent from '@/components/MarkdownContent.vue';
import { InfiniteScrollPagination, StickyActionBar } from '@/capabilities/design-system/public';
import { countEssayWords, describeEssayWordCount } from '@/domain/essayAnswer';
import { splitEssayMaterial, splitEssayRequirement } from '@/domain/essayQuestionText';
import type { EssayHistoryRecord, EssayQuestionSetSummary } from '@/services/EssayRepository';
import { essayRepository } from '@/services/EssayRepository';
import { useEssayStore } from '@/stores/essay';
import { essayFlowService, type EssayContext } from '@/services/EssayFlowService';
import {
  essayCenterLocation,
  essayQuestionSetLocation,
  essayQuestionSetTargetFromQuery
} from '@/features/practice/EssayNavigation';
import { useEssayGradingWatcher } from '@/features/practice/useEssayGradingWatcher';
import { useEssaySessionTimer } from '@/features/practice/useEssaySessionTimer';

const HISTORY_PREVIEW_COUNT = 3;
const QUESTION_HISTORY_PAGE_SIZE = 20;

const store = useEssayStore();
const route = useRoute();
const router = useRouter();
const {
  elapsedText,
  isRunning: isTimerRunning,
  activate: activateTimer,
  restore: restoreTimer,
  start: startTimer,
  pause: pauseTimer,
  toggle: toggleTimer,
  clear: clearTimer
} = useEssaySessionTimer();
const {
  isGrading,
  progressText: gradingProgress,
  failure: gradingFailure,
  track: trackGrading,
  resume: resumeGrading,
  stop: stopGrading
} = useEssayGradingWatcher({ onGraded: () => store.refresh() });

const activeMode = ref<'lecture' | 'question'>('question');
const isAnswerSheetOpen = ref(false);
const showHistorySheet = ref(false);
const showQuestionHistorySheet = ref(false);
const showDeleteConfirmSheet = ref(false);
const questionHistory = ref<EssayQuestionSetSummary[]>([]);
const questionHistoryTotal = ref(0);
const questionHistoryHasMore = computed(() => questionHistory.value.length < questionHistoryTotal.value);
const answerSheetHeight = ref(42);
let resizeStartY = 0;
let resizeStartHeight = 0;
let openedQuestionSetId = '';

onMounted(() => openRouteTarget());

/**
 * The route can change without remounting — a task card linking to another set reuses this
 * component — so the query is the source of truth for which set is on screen.
 */
watch(() => route.query.questionSetId, () => {
  const target = essayQuestionSetTargetFromQuery(route.query);
  if (target && target.questionSetId === openedQuestionSetId) return;
  void openRouteTarget();
});

onUnmounted(() => {
  window.removeEventListener('pointermove', resizeAnswerSheet);
});

async function openRouteTarget() {
  const target = essayQuestionSetTargetFromQuery(route.query);
  if (!target) {
    openedQuestionSetId = '';
    store.reset({ loading: true });
    await router.replace(essayCenterLocation());
    return;
  }
  stopGrading();
  await openContext(essayFlowService.writeContext(target));
}

async function openContext(context: EssayContext) {
  openedQuestionSetId = context.questionSetId;
  isAnswerSheetOpen.value = false;
  activateTimer(context.questionSetId);
  await store.fetchQuestion(context);
  restoreTimer();
  await resumeGrading(context.questionSetId);
}

function reload() {
  return openRouteTarget();
}

const updateContent = (event: Event) => {
  const target = event.target as HTMLTextAreaElement;
  store.updateContent(target.value);
};

const activeTopic = computed(() => store.context?.topic || '申论练习');
const essayHeaderTitle = computed(() => `申论 · ${activeTopic.value}`);
const essaySessionMeta = computed(() => {
  const mode = store.context?.entryMode === 'tutor'
    ? '私教训练'
    : store.context?.entryMode === 'true'
      ? '真题练习'
      : '自主刷题';
  if (activeMode.value === 'lecture') return `${mode} · 配套讲义`;
  if (store.preview) return `${mode} · 历史回顾`;
  if (store.submission.feedback) return `${mode} · 批改结果`;
  return `${mode} · ${store.submission.content ? '继续作答' : '未作答'}`;
});
const gradingStatusText = computed(() => {
  if (store.submission.isSubmitting) return '正在提交批改任务...';
  if (isGrading.value) return gradingProgress.value || '正在批改，完成后会自动显示';
  return '';
});
const pageAlert = computed(() => gradingFailure.value || (store.question ? store.error || '' : ''));
const isLongEssay = computed(() => store.context?.type === 'long' || activeTopic.value === '申发论述');
const activeLecture = computed(() => store.question?.lecture);
const lectureSections = computed(() => {
  const lecture = activeLecture.value;
  if (!lecture) return [];
  return [
    { title: '审题抓手', items: lecture.clues },
    { title: '核心方法', items: lecture.methods },
    { title: '作答结构', items: lecture.structure },
    { title: '易错提醒', items: lecture.warnings },
    { title: '规范表达', items: lecture.cases },
    { title: '训练任务', items: lecture.drills }
  ].filter((section) => section.items?.length);
});
const hasLecture = computed(() => Boolean(activeLecture.value?.title || lectureSections.value.length));
const materialParagraphs = computed(() => splitEssayMaterial(store.question?.material || ''));
const requirementTasks = computed(() => splitEssayRequirement(store.question?.requirement || ''));
const wordCount = computed(() => describeEssayWordCount(store.submission.content, store.question?.requirement || ''));
const hasWordBudget = computed(() => Boolean(wordCount.value.limit.max || wordCount.value.limit.min));
const wordBudgetLabel = computed(() => {
  const { min, max } = wordCount.value.limit;
  if (min && max) return `${min}–${max} 字`;
  if (max) return `不超过 ${max} 字`;
  return `不少于 ${min} 字`;
});
const visibleHistory = computed(() => store.history.slice(0, HISTORY_PREVIEW_COUNT));
const historyCountLabel = computed(() => (
  store.history.length > HISTORY_PREVIEW_COUNT
    ? `最近 ${HISTORY_PREVIEW_COUNT} 条 · 共 ${store.history.length} 条`
    : `共 ${store.history.length} 条`
));

async function submitForGrading() {
  const submittedQuestionSetId = store.context?.questionSetId;
  const run = await store.submitForGrading();
  // A failed enqueue leaves the candidate still answering, so the clock keeps running.
  if (!run || !submittedQuestionSetId || store.context?.questionSetId !== submittedQuestionSetId) return;
  pauseTimer();
  isAnswerSheetOpen.value = false;
  trackGrading(run);
}

function deleteCurrentEssay() {
  showDeleteConfirmSheet.value = true;
}

async function confirmDeleteCurrentEssay() {
  showDeleteConfirmSheet.value = false;
  const context = store.context;
  if (!context) return;
  isAnswerSheetOpen.value = false;
  activeMode.value = 'question';
  stopGrading();
  clearTimer();
  try {
    store.applyState(await essayRepository.deleteState(context));
    store.closePreview();
  } catch (cause) {
    store.reportError(cause);
  }
}

function openHistoryItem(item: EssayHistoryRecord) {
  showHistorySheet.value = false;
  activeMode.value = 'question';
  store.previewAttempt(item);
}

async function openQuestionHistory() {
  try {
    const [items, total] = await Promise.all([
      essayRepository.listStates({ limit: QUESTION_HISTORY_PAGE_SIZE }),
      essayRepository.countStates()
    ]);
    questionHistory.value = items;
    questionHistoryTotal.value = total;
    showQuestionHistorySheet.value = true;
  } catch (cause) {
    store.reportError(cause);
  }
}

async function loadMoreQuestionHistory() {
  if (!questionHistoryHasMore.value) return;
  try {
    const next = await essayRepository.listStates({
      offset: questionHistory.value.length,
      limit: QUESTION_HISTORY_PAGE_SIZE
    });
    questionHistory.value = [...questionHistory.value, ...next];
  } catch (cause) {
    store.reportError(cause);
  }
}

async function openQuestionHistoryItem(item: EssayQuestionSetSummary) {
  showQuestionHistorySheet.value = false;
  activeMode.value = 'question';
  stopGrading();
  const context = essayFlowService.writeContext(item.context);
  await openContext(context);
  await router.replace(essayQuestionSetLocation({
    questionSetId: context.questionSetId,
    entryMode: context.entryMode,
    date: context.date,
    topic: context.topic,
    type: context.type,
    purpose: context.purpose
  }));
}

function openAnswerSheet() {
  activeMode.value = 'question';
  store.closePreview();
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
  border-radius: var(--radius-pill);
  padding: 0 6px;
  background: rgba(var(--color-ink-rgb), .045);
  color: var(--text-secondary-color);
  font: inherit;
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
  font-variant-numeric: tabular-nums;
}
.essay-session-timer.running {
  background: var(--color-brand-soft);
  color: var(--primary-color);
}
.essay-session-timer svg { width: 12px; height: 12px; }
.essay-tabs {
  flex-shrink: 0;
  align-self: center;
  display: flex;
  gap: 3px;
  margin: 6px auto 0;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: rgba(var(--color-ink-rgb), .055);
}
.essay-tabs button {
  min-width: 74px;
  height: 30px;
  border: none;
  border-radius: var(--radius-pill);
  color: var(--text-secondary-color);
  background: transparent;
  font: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.essay-tabs button.active {
  color: var(--text-color);
  background: var(--surface-card-strong);
  box-shadow: 0 1px 5px rgba(var(--color-ink-rgb), .08);
}
.essay-status,
.essay-alert {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 8px 0 0;
  padding: 9px 11px;
  border-radius: var(--radius-control);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.essay-status {
  color: var(--primary-color);
  background: var(--color-brand-soft);
}
.essay-status svg {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  animation: essaySpin 1.1s linear infinite;
}
.essay-alert {
  color: var(--red-color);
  background: var(--color-danger-soft);
}
.essay-loading {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
}
.essay-loading-block {
  min-height: 280px;
  border-radius: var(--radius-card);
  background: linear-gradient(
    rgba(var(--color-ink-rgb), .09) 0 18px, transparent 18px 30px,
    rgba(var(--color-ink-rgb), .07) 30px 48px, transparent 48px 64px,
    rgba(var(--color-ink-rgb), .055) 64px 132px, transparent 132px 148px,
    rgba(var(--color-ink-rgb), .055) 148px 216px, transparent 216px
  );
  animation: essayLoadingPulse 1.25s ease-in-out infinite;
}
.essay-loading-label {
  margin: 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  text-align: center;
}
.essay-empty { min-height: 320px; display: grid; place-content: center; gap: 8px; padding: 30px 18px; text-align: center; color: var(--text-secondary-color); }
.essay-empty strong { color: var(--text-color); font-size: var(--type-size-section-title); }
.essay-empty p { margin: 0; line-height: 1.6; }
.essay-retry {
  justify-self: center;
  min-height: 38px;
  margin-top: 4px;
  border: none;
  border-radius: var(--radius-control);
  padding: 0 18px;
  color: var(--primary-color);
  background: var(--color-brand-soft);
  font: inherit;
  font-weight: var(--type-weight-semibold);
}
.content-area {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-bottom: 10px;
}
.lecture-section {
  padding: 2px 0 0;
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
  font-size: var(--type-size-section-title);
  line-height: 1.4;
}
.lecture-head p {
  margin: 0;
  color: var(--text-color);
  font-size: var(--type-size-body);
  line-height: 1.7;
}
.lecture-grid {
  display: flex;
  flex-direction: column;
  margin-top: 14px;
}
.lecture-grid article {
  padding: 13px 0;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.lecture-grid strong {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
  letter-spacing: 0;
}
/* Six undifferentiated grey lists are unscannable; each point gets a mark to land on. */
.lecture-grid em {
  position: relative;
  padding-left: 13px;
  color: var(--text-color);
  font-size: var(--type-size-secondary);
  font-style: normal;
  line-height: 1.62;
}
.lecture-grid em::before {
  content: '';
  position: absolute;
  left: 2px;
  top: .62em;
  width: 4px;
  height: 4px;
  border-radius: var(--radius-pill);
  background: rgba(var(--color-brand-rgb), .38);
}
.question-section {
  margin: 0;
  padding: 2px 0 0;
}
.question-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.question-meta span {
  padding: 3px 9px;
  border-radius: var(--radius-pill);
  background: var(--color-brand-soft);
  color: var(--primary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.question-meta em,
.question-meta b {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}
.question-meta b {
  margin-left: auto;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: var(--surface-muted);
}
.question-section h4 {
  margin: 0 0 10px;
  line-height: 1.4;
  font-size: var(--type-size-section-title);
}
.material-block,
.requirement-block {
  margin-top: 14px;
  padding: 14px 0 0;
  border-top: 1px solid var(--border-subtle);
}
.material-block strong,
.requirement-block strong {
  display: block;
  margin-bottom: 8px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
  letter-spacing: 0;
}
/* This is the prose the candidate reads for minutes at a time, so it is primary text. */
.material-block p,
.requirement-block p,
.requirement-block li {
  margin: 0;
  color: var(--text-color);
  font-size: var(--type-size-body-large);
  line-height: 1.78;
}
.material-block p + p {
  margin-top: 12px;
}
.requirement-block ol {
  margin: 0;
  padding-left: 18px;
}
.requirement-block li + li {
  margin-top: 6px;
}
.attempt-preview {
  padding: 13px 14px;
  border-radius: var(--radius-card);
  border: 1px solid var(--border-control);
  background: var(--surface-card);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.attempt-preview header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.attempt-preview header div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.attempt-preview header strong { font-size: var(--type-size-secondary); }
.attempt-preview header span { color: var(--text-secondary-color); font-size: var(--type-size-micro); }
.attempt-preview header button {
  flex: 0 0 auto;
  min-height: 30px;
  border: none;
  border-radius: var(--radius-pill);
  padding: 0 11px;
  color: var(--primary-color);
  background: var(--color-brand-soft);
  font: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.attempt-preview-answer {
  padding: 12px 0 0;
  border-top: 1px solid var(--border-subtle);
}
.attempt-preview-answer strong {
  display: block;
  margin-bottom: 8px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
  letter-spacing: 0;
}
.attempt-preview-answer p {
  margin: 0;
  color: var(--text-color);
  font-size: var(--type-size-body);
  line-height: 1.78;
  white-space: pre-wrap;
}
.feedback-section { padding: 16px; background: var(--soft-blue); border-radius: var(--radius-card); line-height: 1.7; }
.feedback-section h4 { margin: 0 0 8px; }
.feedback-section :deep(p) { margin: 0; }
/* A supporting block, deliberately lighter than the question so the page has one subject. */
.history-section { padding: 14px; border: 1px solid var(--border-subtle); border-radius: var(--radius-card); background: var(--surface-card); }
.history-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.history-title strong { font-size: var(--type-size-body); }
.history-title span { color: var(--text-secondary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); }
.history-row { padding: 10px 0; border-top: 1px solid var(--border-subtle); }
.history-row:first-of-type { border-top: none; padding-top: 0; }
.history-row div { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.history-row strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--type-size-secondary); }
.history-row span { flex-shrink: 0; color: var(--text-secondary-color); font-size: var(--type-size-micro); }
.history-feedback { margin: 6px 0 0; color: var(--text-secondary-color); font-size: var(--type-size-caption); line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.dimension-list { display: flex; flex-direction: column; gap: 5px; margin: 8px 0 0; padding: 0; list-style: none; }
/* Name and score share a line; the comment gets its own so a score never reads as part of the prose. */
.dimension-list li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 6px; color: var(--text-secondary-color); font-size: var(--type-size-micro); }
.dimension-list b { color: var(--text-color); font-weight: var(--type-weight-semibold); }
.dimension-list em { font-style: normal; color: var(--primary-color); font-weight: var(--type-weight-semibold); font-variant-numeric: tabular-nums; }
.dimension-list span { flex-basis: 100%; min-width: 0; font-size: var(--type-size-caption); line-height: 1.5; }
.essay-start-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 50px;
  font-size: var(--type-size-control);
  font-weight: var(--type-weight-semibold);
}
.essay-start-button svg {
  width: 18px;
  height: 18px;
}
.answer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  border: none;
  background: var(--app-overlay-bg);
  padding: 0;
}
.answer-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 71;
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  display: flex;
  flex-direction: column;
  background: var(--app-sheet-bg);
  box-shadow: var(--shadow-dialog);
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
  border-radius: var(--radius-pill);
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
  border-radius: var(--radius-pill);
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
  border-radius: var(--radius-pill);
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
  font: inherit;
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
  border-top: 1px solid var(--border-subtle);
}
.answer-word-count {
  min-width: 44px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
  font-variant-numeric: tabular-nums;
}
.answer-word-count.warning { color: var(--orange-color); }
.answer-word-count.danger { color: var(--red-color); }
.answer-sheet-foot button {
  height: 38px;
  border: none;
  border-radius: var(--radius-control);
  padding: 0 13px;
  font: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
.answer-sheet-foot .ghost {
  background: var(--surface-control);
  color: var(--text-secondary-color);
}
.answer-sheet-foot .primary {
  flex: 1;
  background: var(--primary-color);
  color: var(--color-text-inverse);
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
  border-radius: var(--radius-card);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 8px 12px;
  background: var(--surface-card);
  color: var(--text-color);
  font: inherit;
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
  transition: opacity var(--motion-fast) ease;
}
.answer-backdrop-enter-from,
.answer-backdrop-leave-to {
  opacity: 0;
}
.answer-sheet-enter-active,
.answer-sheet-leave-active {
  transition: transform var(--motion-normal) ease;
}
.answer-sheet-enter-from,
.answer-sheet-leave-to {
  transform: translateY(100%);
}
@keyframes essaySpin { to { transform: rotate(360deg); } }
@keyframes essayLoadingPulse { 50% { opacity: .48; } }
</style>
