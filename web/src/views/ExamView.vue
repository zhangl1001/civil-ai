<template>
  <div class="exam-page app-page">
    <PageHeader title="模拟考试" :meta="dashboard?.projectName || '公考练习'" />

    <PullToRefresh class="exam-content" :on-refresh="loadDashboard">
      <section class="exam-hero app-card">
        <div>
          <span>{{ subject?.name }}模考</span>
          <strong>{{ subject ? mockHeadline(subject) : '' }}</strong>
          <em>模考用于阶段校准，结果会回流到练习记录、错题本和能力画像。</em>
        </div>
        <MonitorIcon />
      </section>

      <section class="status-strip">
        <article class="app-card">
          <strong>{{ stats.total }}</strong>
          <span>已完成</span>
        </article>
        <article class="app-card">
          <strong>{{ stats.averageAccuracy ? `${stats.averageAccuracy}%` : '--' }}</strong>
          <span>平均正确率</span>
        </article>
        <article class="app-card">
          <strong>{{ stats.bestAccuracy ? `${stats.bestAccuracy}%` : '--' }}</strong>
          <span>最好成绩</span>
        </article>
      </section>

      <section class="generator app-card">
        <div class="section-heading">
          <div>
            <span>当前配置</span>
            <strong>{{ configTitle }}</strong>
            <em>{{ currentConfigText }}</em>
          </div>
          <SlidersHorizontalIcon />
        </div>

        <div class="generator-actions">
          <button class="settings-button" type="button" @click="showSettingsSheet = true">
            <SlidersHorizontalIcon />
            调整条件
          </button>
          <button class="primary-button start-button" type="button" :disabled="isStarting" @click="startExam">
            <RocketIcon />
            {{ startButtonText }}
          </button>
        </div>
        <p v-if="notice" class="notice">{{ notice }}</p>
      </section>

      <section class="history-section">
        <SectionHeading title="我的模考记录" :meta="stats.total ? `共 ${stats.total} 条` : '暂无记录'" />

        <AppStateView v-if="isLoading" compact state="loading" title="加载模考记录" />
        <AppStateView v-else-if="!history.length" compact :title="subject ? emptyHistoryTitle(subject) : '还没有模考记录'" description="完成一次模考后，成绩会自动回流到这里。">
          <template #icon><BookOpenIcon /></template>
        </AppStateView>
        <InfiniteScrollPagination v-else :has-more="historyVisibleCount < history.length || (!isObjective && history.length < stats.total)" :has-items="Boolean(history.length)" :on-load-more="loadMoreHistory">
        <div class="history-groups">
          <div v-for="group in groupedHistory" :key="group.month" class="history-group">
            <div class="month-label">
              <strong>{{ group.label }}</strong>
              <span>{{ group.items.length }} 次</span>
            </div>
            <button
              v-for="item in group.items"
              :key="item.id"
              class="history-row"
              type="button"
              @click="openHistory(item)"
            >
              <div>
                <strong>{{ item.title }}</strong>
                <span>{{ item.questionCount }} 题 · {{ durationText(item.durationMs) }}</span>
              </div>
              <em>{{ item.correctCount }}/{{ item.questionCount }} · {{ item.accuracy }}%</em>
              <ChevronRightIcon />
            </button>
          </div>
        </div>
        </InfiniteScrollPagination>
      </section>
    </PullToRefresh>

    <BottomSheet v-model="showSettingsSheet" title="模考条件" :subtitle="currentConfigText" variant="filter">
      <div class="exam-settings">
        <div class="subject-toggle" role="tablist" aria-label="模考科目">
          <button
            v-for="item in subjects"
            :key="item.code"
            type="button"
            :class="{ active: subject?.code === item.code }"
            @click="switchSubject(item)"
          >
            {{ item.name }}
          </button>
        </div>

        <div class="form-row">
          <label>考试日期</label>
          <input
            v-model="date"
            type="text"
            inputmode="numeric"
            maxlength="10"
            placeholder="2026-07-15"
            @input="formatExamDateInput"
          />
        </div>

        <template v-if="isObjective">
          <div class="scheme-grid">
            <button
              v-for="scheme in mockSchemes"
              :key="scheme.code"
              type="button"
              :class="{ active: questionCount === scheme.questionCount }"
              @click="selectScheme(scheme.questionCount, scheme.durationMinutes)"
            >
              <strong>{{ scheme.name }}</strong>
              <span>{{ scheme.questionCount }} 题 · {{ scheme.durationMinutes }} 分钟</span>
            </button>
          </div>

          <div class="tag-panel">
            <label>侧重方向</label>
            <div>
              <button
                v-for="tag in focusTags"
                :key="tag"
                type="button"
                :class="{ active: selectedTags.includes(tag) }"
                @click="toggleTag(tag)"
              >
                {{ tag }}
              </button>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="essay-type">
            <button type="button" :class="{ active: essayType === 'short' }" @click="essayType = 'short'">{{ essayTypeLabel('short') }}</button>
            <button type="button" :class="{ active: essayType === 'long' }" @click="essayType = 'long'">{{ essayTypeLabel('long') }}</button>
          </div>
        </template>
      </div>
    </BottomSheet>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  BookOpenIcon,
  ChevronRightIcon,
  MonitorIcon,
  RocketIcon,
  SlidersHorizontalIcon
} from 'lucide-vue-next';
import { examFlowService, type ExamDashboard, type ExamHistoryItem } from '@/services/ExamFlowService';
import type { EssayMockType, ExamStartContext } from '@/domain/examMock';
import { ExamDeliveryKind, type ExamSubjectView } from '@/modules/curriculum/public';
import PageHeader from '@/components/layout/PageHeader.vue';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import { AppStateView, InfiniteScrollPagination, PullToRefresh, SectionHeading } from '@/capabilities/design-system/public';
import { practiceDetailLocation } from '@/features/practice/PracticeNavigation';
import { essayHistoryLocation } from '@/features/practice/EssayNavigation';
import { durationText, groupHistoryByMonth } from '@/features/exam/ExamHistoryPresentation';
import {
  emptyHistoryTitle,
  essayTypeLabel,
  mockConfigSummary,
  mockConfigTitle,
  mockHeadline,
  mockStartLabel
} from '@/features/exam/ExamSubjectPresentation';
const router = useRouter();
const date = ref('');
const questionCount = ref(0);
const durationMinutes = ref(0);
const selectedTags = ref<string[]>([]);
const essayType = ref<EssayMockType>('short');
const dashboard = ref<ExamDashboard | null>(null);
const isLoading = ref(false);
const isStarting = ref(false);
const notice = ref('');
const showSettingsSheet = ref(false); const historyVisibleCount = ref(30);
const subjects = computed(() => dashboard.value?.subjects || []);
const subject = computed(() => dashboard.value?.subject);
const isObjective = computed(() => subject.value?.deliveryKind === ExamDeliveryKind.Objective);
const mockSchemes = computed(() => subject.value?.mockExam?.schemes || []);
const focusTags = computed(() => subject.value?.mockExam?.focusTags || []);
const history = computed(() => dashboard.value?.history || []);
const stats = computed(() => dashboard.value?.stats || { total: 0, averageAccuracy: 0, bestAccuracy: 0 });
const groupedHistory = computed(() => groupHistoryByMonth(history.value.slice(0, historyVisibleCount.value)));
const currentContext = computed<ExamStartContext | undefined>(() => {
  const active = subject.value;
  if (!active) return undefined;
  return {
    subjectCode: active.code,
    date: date.value,
    questionCount: isObjective.value ? questionCount.value : (active.mockExam?.defaultQuestionCount ?? 1),
    durationMinutes: isObjective.value ? durationMinutes.value : (active.mockExam?.defaultDurationMinutes ?? 120),
    tags: selectedTags.value,
    essayType: essayType.value
  };
});
const configTitle = computed(() => {
  const active = subject.value;
  const context = currentContext.value;
  return active && context ? mockConfigTitle(active, context) : '';
});
const currentConfigText = computed(() => {
  const active = subject.value;
  const context = currentContext.value;
  return active && context ? mockConfigSummary(active, context) : '';
});
const startButtonText = computed(() => {
  if (isStarting.value) return '任务派发中...';
  return subject.value ? mockStartLabel(subject.value) : '生成模考';
});
onMounted(loadDashboard);
async function loadDashboard(subjectCode?: ExamSubjectView['code']) {
  isLoading.value = true;
  notice.value = '';
  try {
    const next = await examFlowService.dashboard(subjectCode);
    dashboard.value = next;
    historyVisibleCount.value = 30;
    applyContext(examFlowService.readContext(next.subject));
    applyDefaultScheme();
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '模考数据加载失败';
  } finally {
    isLoading.value = false;
  }
}
function applyContext(context: ExamStartContext) {
  date.value = context.date;
  questionCount.value = context.questionCount;
  durationMinutes.value = context.durationMinutes;
  selectedTags.value = [...context.tags];
  essayType.value = context.essayType;
}
async function loadMoreHistory() {
  if (historyVisibleCount.value < history.value.length) {
    historyVisibleCount.value = Math.min(history.value.length, historyVisibleCount.value + 30);
    return;
  }
  const active = subject.value;
  if (isObjective.value || !active || !dashboard.value || history.value.length >= stats.value.total) return;
  const next = await examFlowService.listEssayMockHistory(active.code, history.value.length, 30);
  dashboard.value = { ...dashboard.value, history: [...dashboard.value.history, ...next] };
  historyVisibleCount.value = dashboard.value.history.length;
}
async function switchSubject(next: ExamSubjectView) {
  if (subject.value?.code === next.code) return;
  await loadDashboard(next.code);
  const context = currentContext.value;
  if (context) examFlowService.writeContext(context);
}
function applyDefaultScheme() {
  const spec = subject.value?.mockExam;
  if (!isObjective.value || !spec) return;
  const scheme = spec.schemes.find((item) => item.questionCount === questionCount.value)
    || spec.schemes.find((item) => item.questionCount === spec.defaultQuestionCount)
    || spec.schemes[0];
  if (!scheme) return;
  questionCount.value = scheme.questionCount;
  durationMinutes.value = scheme.durationMinutes;
}
function selectScheme(count: number, minutes: number) {
  questionCount.value = count;
  durationMinutes.value = minutes;
}

function toggleTag(tag: string) {
  selectedTags.value = selectedTags.value.includes(tag)
    ? selectedTags.value.filter((item) => item !== tag)
    : [...selectedTags.value, tag];
}

function formatExamDateInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const digits = input.value.replace(/\D/g, '').slice(0, 8);
  date.value = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean).join('-');
}

async function startExam() {
  const context = currentContext.value;
  if (!context) return;
  isStarting.value = true;
  notice.value = '';
  try {
    const result = await examFlowService.startMock(context);
    notice.value = result.reused ? '已有相同模考任务在执行，可在任务栏查看进度。' : '模考任务已加入执行队列。';
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '模考任务派发失败';
  } finally {
    isStarting.value = false;
  }
}

function openHistory(item: ExamHistoryItem) {
  if (!isObjective.value) {
    router.push(essayHistoryLocation(item));
    return;
  }
  if (item.manifestId) {
    router.push({ path: '/vue/practice/objective-session', query: { manifestId: item.manifestId } });
    return;
  }
  router.push(practiceDetailLocation({ mode: 'self' }));
}

</script>

<style scoped>
.exam-page {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.exam-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.exam-hero {
  min-height: 112px;
  padding: 16px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px;
  gap: 14px;
  align-items: center;
}

.exam-hero span {
  color: var(--primary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.exam-hero strong {
  display: block;
  margin-top: 4px;
  color: var(--text-color);
  font-size: var(--type-size-section-title);
  line-height: 1.25;
}

.exam-hero em {
  display: block;
  margin-top: 7px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  line-height: 1.5;
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}

.exam-hero > svg {
  width: 38px;
  height: 38px;
  padding: 8px;
  border-radius: 15px;
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .1);
}

.title-row,
.history-row {
  display: flex;
  align-items: center;
}

.title-row {
  justify-content: space-between;
  gap: 12px;
}

h3 {
  margin: 0;
  font-size: var(--type-size-page-title);
}

.icon-button svg {
  width: 18px;
  height: 18px;
}

.subject-toggle {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  margin-top: 14px;
  padding: 4px;
  border-radius: 12px;
  background: rgba(var(--color-ink-rgb), .06);
}

.subject-toggle button,
.scheme-grid button,
.tag-panel button,
.essay-type button,
.history-row {
  font: inherit;
}

.subject-toggle button {
  height: 34px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}

.subject-toggle button.active {
  background: rgba(255, 255, 255, .94);
  color: var(--primary-color);
  box-shadow: 0 5px 14px rgba(28, 38, 58, .08);
}

.status-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.status-strip article {
  min-width: 0;
  min-height: 72px;
  padding: 12px 8px;
  text-align: center;
}

.status-strip strong,
.status-strip span {
  display: block;
}

.status-strip strong {
  color: var(--primary-color);
  font-size: var(--type-size-section-title);
}

.status-strip span {
  margin-top: 2px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.generator {
  padding: 16px;
}

.section-heading {
  justify-content: space-between;
  gap: 14px;
}

.section-heading > div {
  min-width: 0;
}

.section-heading span,
.tag-panel label,
.form-row label {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.section-heading strong {
  display: block;
  margin-top: 3px;
  font-size: var(--type-size-control);
}

.section-heading em {
  display: block;
  max-width: 100%;
  margin-top: 6px;
  overflow: hidden;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-heading svg {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  color: var(--primary-color);
}

.generator-actions {
  display: grid;
  grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr);
  gap: 9px;
  margin-top: 14px;
}

.settings-button {
  width: 100%;
  min-height: 42px;
  border: 1px solid rgba(var(--color-brand-rgb), .12);
  border-radius: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  background: rgba(var(--color-brand-rgb), .08);
  color: var(--primary-color);
  font: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}

.settings-button:active {
  transform: translateY(1px);
}

.settings-button svg {
  width: 16px;
  height: 16px;
}

.exam-settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.exam-settings .subject-toggle,
.exam-settings .form-row,
.exam-settings .scheme-grid,
.exam-settings .tag-panel,
.exam-settings .essay-type {
  margin-top: 0;
}

.form-row {
  margin-top: 14px;
}

.form-row label,
.tag-panel label {
  display: block;
  margin-bottom: 8px;
}

.form-row input {
  width: 100%;
  height: 40px;
  box-sizing: border-box;
  border: 1px solid rgba(var(--color-ink-rgb), .08);
  border-radius: 12px;
  padding: 0 12px;
  background: rgba(255, 255, 255, .9);
  color: var(--text-color);
  font-size: var(--type-size-body);
}

.scheme-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.scheme-grid button {
  min-width: 0;
  min-height: 66px;
  border: 1px solid rgba(var(--color-ink-rgb), .08);
  border-radius: 12px;
  background: rgba(255, 255, 255, .76);
  color: var(--text-color);
}

.scheme-grid button.active {
  border-color: rgba(var(--color-brand-rgb), .28);
  background: rgba(var(--color-brand-rgb), .1);
  color: var(--primary-color);
}

.scheme-grid strong,
.scheme-grid span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scheme-grid strong {
  font-size: var(--type-size-secondary);
}

.scheme-grid span {
  margin-top: 5px;
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.tag-panel,
.essay-type {
  margin-top: 14px;
}

.tag-panel div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-panel button {
  height: 30px;
  border: none;
  border-radius: 15px;
  padding: 0 12px;
  background: rgba(var(--color-ink-rgb), .06);
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.tag-panel button.active {
  background: rgba(var(--color-brand-rgb), .12);
  color: var(--primary-color);
}

.essay-type {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.essay-type button {
  height: 42px;
  border: 1px solid rgba(var(--color-ink-rgb), .08);
  border-radius: 12px;
  background: rgba(255, 255, 255, .76);
  color: var(--text-secondary-color);
  font-size: var(--type-size-body);
  font-weight: var(--type-weight-semibold);
}

.essay-type button.active {
  border-color: rgba(var(--color-brand-rgb), .28);
  background: rgba(var(--color-brand-rgb), .1);
  color: var(--primary-color);
}

.start-button {
  margin-top: 0;
}

.start-button svg {
  width: 17px;
  height: 17px;
}

.notice {
  margin: 10px 0 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  line-height: 1.5;
}

.history-section {
  margin: 0 0 8px;
}

.history-groups {
  display: grid;
  gap: 12px;
}

.history-group {
  display: grid;
  gap: 6px;
}

.month-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px;
}

.month-label strong {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
}

.month-label span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.section-heading {
  margin: 0 0 8px;
}

.empty-state {
  min-height: 132px;
  border: 1px solid rgba(var(--color-ink-rgb), .06);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(255, 255, 255, .68);
  color: var(--text-secondary-color);
  text-align: center;
  font-size: var(--type-size-secondary);
}

.empty-state svg {
  width: 26px;
  height: 26px;
  color: var(--primary-color);
}

.empty-state strong {
  color: var(--text-color);
  font-size: var(--type-size-body);
}

.history-row {
  width: 100%;
  min-height: 58px;
  justify-content: space-between;
  gap: 10px;
  margin: 0;
  border: 1px solid rgba(var(--color-ink-rgb), .06);
  border-radius: 14px;
  padding: 10px 10px 10px 12px;
  background: rgba(255, 255, 255, .76);
  color: var(--text-color);
  text-align: left;
}

.history-row div {
  min-width: 0;
  flex: 1;
}

.history-row strong,
.history-row span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-row strong {
  font-size: var(--type-size-secondary);
}

.history-row span {
  margin-top: 4px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.history-row em {
  flex-shrink: 0;
  color: var(--primary-color);
  font-size: var(--type-size-caption);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}

.history-row svg {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  color: rgba(var(--color-ink-rgb), .28);
}
</style>
