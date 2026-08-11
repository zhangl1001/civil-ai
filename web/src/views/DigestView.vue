<template>
  <div class="digest-page app-page">
    <PageHeader title="每日积累" :meta="dashboard?.date || date">
      <template #actions>
        <HeaderMoreMenu title="积累操作" subtitle="历史和生成">
          <button class="menu-row" type="button" @click="showHistorySheet = true"><HistoryIcon />历史文件</button>
          <button class="menu-row" type="button" :disabled="isGenerating" @click="generate"><SparklesIcon />AI 生成</button>
          <button class="menu-row danger" type="button" :disabled="!sections.length" @click="showDeleteConfirm = true"><Trash2Icon />删除当前</button>
        </HeaderMoreMenu>
      </template>

    </PageHeader>

    <PullToRefresh class="digest-scroll" :on-refresh="loadDashboard">
      <SegmentedControl
        :model-value="tab"
        label="积累内容类型"
        :options="digestTabOptions"
        @update:model-value="switchDigestMode"
      />

      <AppStateView v-if="isLoading" state="loading" title="加载每日积累" />

      <AiTaskPendingState
        v-else-if="visibleTask"
        :task="visibleTask"
        title="AI 正在整理每日积累"
        :description="visibleTask.message || visibleTask.detail || '正在生成学习内容，完成后会自动刷新。'"
        ready-action-label="重新生成"
        retry-action-label="重新生成"
        @start="generate"
        @retry="generate"
        @cancel="cancelGeneration"
      />

      <AppStateView
        v-else-if="!sections.length"
        title="开启今日专属积累"
        :description="tab === 'news' ? '生成今日时政热点、关键词和公考切入角度。' : '生成今日公考知识点、易错提醒和短练建议。'"
      >
        <template #icon><SparklesIcon /></template>
        <template #actions>
          <button class="primary-button" type="button" :disabled="isGenerating" @click="generate">
            <SparklesIcon />
            {{ isGenerating ? '任务派发中...' : '一键生成今日内容' }}
          </button>
          <p v-if="notice" class="notice">{{ notice }}</p>
        </template>
      </AppStateView>

      <template v-else>
        <section class="digest-section-heading">
          <div>
            <strong>{{ tab === 'news' ? '今日热点' : '今日知识点' }}</strong>
            <span>{{ sections.length }} 个条目</span>
          </div>
          <button type="button" :disabled="isGenerating" title="重新生成" aria-label="重新生成" @click="generate">
            <SparklesIcon />
          </button>
        </section>

        <article v-for="section in sections" :key="section.id" class="digest-card app-card">
          <span class="digest-tag" :class="tab">{{ tab === 'news' ? '热点' : '知识点' }}</span>
          <h4>{{ section.title }}</h4>
          <MarkdownContent class="digest-body" :content="section.body" variant="compact" />
        </article>
        <button
          v-if="dailyPlanItemId && !planItemCompleted"
          type="button"
          class="complete-digest-button"
          :disabled="isCompleting"
          @click="completePlanDigest"
        >
          <CheckCircle2Icon />{{ isCompleting ? '正在更新计划' : '完成今日积累' }}
        </button>
        <p v-else-if="planItemCompleted" class="completion-notice"><CheckCircle2Icon />今日积累已完成，计划已更新</p>
      </template>
    </PullToRefresh>

    <BottomSheet v-model="showHistorySheet" :title="`历史${tab === 'news' ? '热点' : '知识点'}`" subtitle="按日期选择内容" variant="actions">
      <div v-if="historyGroups.length" class="digest-history-list">
        <section v-for="group in historyGroups" :key="group.month">
          <strong>{{ group.month }}</strong>
          <button v-for="item in group.items" :key="item.path" type="button" @click="openHistory(item.date)">
            <span>{{ item.date.slice(8) }}日</span>
            <em>{{ item.date === date ? '当前' : item.date }}</em>
            <ChevronRightIcon />
          </button>
        </section>
      </div>
      <AppStateView v-else compact title="暂无历史内容" />
    </BottomSheet>

    <ConfirmDialog
      v-model="showDeleteConfirm"
      title="删除当前积累"
      :description="`将删除 ${date} 的${tab === 'news' ? '热点' : '知识点'}内容。`"
      confirm-text="确认删除"
      tone="danger"
      @confirm="deleteCurrent"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  HistoryIcon,
  SparklesIcon,
  Trash2Icon
} from 'lucide-vue-next';
import { useRoute } from 'vue-router';
import { AppStateView, PullToRefresh, SegmentedControl } from '@/capabilities/design-system/public';
import PageHeader from '@/components/layout/PageHeader.vue';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import ConfirmDialog from '@/components/layout/ConfirmDialog.vue';
import HeaderMoreMenu from '@/components/layout/HeaderMoreMenu.vue';
import MarkdownContent from '@/components/MarkdownContent.vue';
import AiTaskPendingState from '@/components/AiTaskPendingState.vue';
import type { DigestTab } from '@/domain/digest';
import type { AgentRunView } from '@/modules/agent/public';
import { digestService, type DigestDashboard } from '@/services/DigestService';
import { useTaskCenterStore } from '@/stores/taskCenter';


const taskCenter = useTaskCenterStore();
const route = useRoute();
const routeTab = route.query.tab === 'tips' ? 'tips' : route.query.tab === 'news' ? 'news' : undefined;
const tab = ref<DigestTab>(routeTab || digestService.readActiveTab());
const date = ref(localDate());
const dashboard = ref<DigestDashboard | null>(null);
const isLoading = ref(false);
const isDispatching = ref(false);
const trackedTaskId = ref('');
const taskSnapshot = ref<AgentRunView>();
const showHistorySheet = ref(false);
const showDeleteConfirm = ref(false);
const notice = ref('');
const isCompleting = ref(false);
const planItemCompleted = ref(false);
const dailyPlanItemId = computed(() => typeof route.query.dailyPlanItemId === 'string' ? route.query.dailyPlanItemId : '');
const capabilityNodeId = computed(() => typeof route.query.capabilityNodeId === 'string' ? route.query.capabilityNodeId : '');
const digestTabOptions = [
  { value: 'news', label: '热点' },
  { value: 'tips', label: '知识点' }
] as const;

const sections = computed(() => dashboard.value?.sections || []);
const history = computed(() => dashboard.value?.history || []);
const scopedTask = computed(() => {
  const scopeKey = dashboard.value?.taskScopeKey;
  if (!scopeKey) return undefined;
  return taskCenter.runs.find((task) => task.scopeKey === scopeKey);
});
const visibleTask = computed(() => {
  const current = scopedTask.value?.id === trackedTaskId.value
    ? scopedTask.value
    : taskCenter.runs.find((task) => task.id === trackedTaskId.value);
  const recovered = scopedTask.value?.isActive ? scopedTask.value : undefined;
  const task = current || recovered || (taskSnapshot.value?.id === trackedTaskId.value ? taskSnapshot.value : undefined);
  return task && (task.isActive || task.status === 'failed' || task.status === 'cancelled') ? task : undefined;
});
const isGenerating = computed(() => isDispatching.value || Boolean(visibleTask.value?.isActive));
const historyGroups = computed(() => {
  const grouped = new Map<string, typeof history.value>();
  history.value.forEach((item) => {
    const month = item.date.slice(0, 7);
    grouped.set(month, [...(grouped.get(month) || []), item]);
  });
  return Array.from(grouped.entries()).map(([month, items]) => ({ month, items }));
});

onMounted(async () => {
  taskCenter.connect();
  await loadDashboard();
  await taskCenter.refresh();
  if (scopedTask.value?.isActive) trackedTaskId.value = scopedTask.value.id;
  if (route.query.start === '1' && dailyPlanItemId.value && !sections.value.length && !visibleTask.value) {
    await generate();
  }
});

onBeforeUnmount(() => {
  taskCenter.disconnect();
});

watch(scopedTask, async (task) => {
  if (!task) return;
  if (task.isActive) {
    trackedTaskId.value = task.id;
    taskSnapshot.value = task;
    return;
  }
  if (task.id !== trackedTaskId.value) return;
  taskSnapshot.value = task;
  if (task.status === 'completed') {
    trackedTaskId.value = '';
    taskSnapshot.value = undefined;
    await loadDashboard();
  }
});

async function loadDashboard() {
  isLoading.value = true;
  notice.value = '';
  try {
    dashboard.value = await digestService.dashboard(tab.value, date.value);
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '每日积累加载失败';
  } finally {
    isLoading.value = false;
  }
}

async function switchTab(next: DigestTab) {
  if (tab.value === next) return;
  trackedTaskId.value = '';
  taskSnapshot.value = undefined;
  tab.value = next;
  date.value = localDate();
  digestService.writeActiveTab(next);
  await loadDashboard();
}

function switchDigestMode(next: string) {
  if (next === 'news' || next === 'tips') void switchTab(next);
}

async function generate() {
  if (isGenerating.value) return;
  isDispatching.value = true;
  notice.value = '';
  try {
    const result = await digestService.enqueueGenerate(
      tab.value,
      date.value,
      undefined,
      dailyPlanItemId.value ? {
        dailyPlanItemId: dailyPlanItemId.value,
        capabilityNodeId: capabilityNodeId.value || undefined
      } : undefined
    );
    trackedTaskId.value = result.task.id;
    taskSnapshot.value = result.task;
    await taskCenter.refresh();
    notice.value = result.reused ? '已有相同内容生成任务在执行。' : '生成任务已加入任务栏。';
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '生成任务派发失败';
  } finally {
    isDispatching.value = false;
  }
}

async function completePlanDigest() {
  if (!dailyPlanItemId.value || isCompleting.value) return;
  isCompleting.value = true;
  try {
    await digestService.completeDailyPlanDigest({
      dailyPlanItemId: dailyPlanItemId.value,
      tab: tab.value,
      date: date.value
    });
    planItemCompleted.value = true;
  } finally {
    isCompleting.value = false;
  }
}

async function cancelGeneration() {
  const task = visibleTask.value;
  if (!task) return;
  await digestService.cancelGeneration(task.id);
  await taskCenter.refresh();
}

async function openHistory(nextDate: string) {
  trackedTaskId.value = '';
  taskSnapshot.value = undefined;
  date.value = nextDate;
  showHistorySheet.value = false;
  await loadDashboard();
}

async function deleteCurrent() {
  showDeleteConfirm.value = false;
  if (!sections.value.length) return;
  await digestService.deleteDate(tab.value, date.value);
  dashboard.value = null;
  notice.value = '已删除当前内容。';
  await loadDashboard();
}

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
</script>

<style scoped>
.digest-scroll {
  gap: 12px;
  padding-top: 12px;
}

.notice {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
}

.digest-section-heading {
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 2px;
}

.digest-section-heading > div {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.digest-section-heading strong {
  font-size: var(--type-size-body-large);
}

.digest-section-heading span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.digest-section-heading button {
  width: 34px;
  flex-shrink: 0;
  height: 34px;
  border: none;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: rgba(var(--color-brand-rgb), .1);
  color: var(--primary-color);
}

.digest-section-heading svg,
.primary-button svg {
  width: 15px;
  height: 15px;
}

.digest-card {
  width: 100%;
  padding: 14px;
}

.complete-digest-button {
  align-self: center;
  min-height: 40px;
  border: 0;
  border-radius: 20px;
  padding: 0 18px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: rgba(var(--color-brand-rgb), .13);
  color: var(--primary-color);
  font: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}

.complete-digest-button svg,
.completion-notice svg { width: 16px; height: 16px; }

.completion-notice {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--primary-color);
  font-size: var(--type-size-caption);
}

.digest-tag {
  display: inline-flex;
  align-items: center;
  height: 22px;
  border-radius: 11px;
  padding: 0 10px;
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.digest-tag.news {
  background: rgba(229, 57, 53, .1);
  color: #d93025;
}

.digest-tag.tips {
  background: rgba(var(--color-brand-rgb), .1);
  color: var(--primary-color);
}

.digest-card h4 {
  margin: 9px 0 7px;
  font-size: var(--type-size-body-large);
  line-height: var(--type-line-title);
}

.digest-body {
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
}

.digest-body :deep(h3),
.digest-body :deep(h4) {
  margin-top: 13px;
  color: var(--text-color);
}

.digest-body :deep(strong) {
  color: var(--text-color);
}

.digest-history-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.digest-history-list section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.digest-history-list section > strong {
  padding: 2px 4px 4px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
}

.digest-history-list button {
  width: 100%;
  min-height: 42px;
  border: none;
  border-bottom: 1px solid rgba(var(--color-ink-rgb), .06);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  background: transparent;
  color: var(--text-color);
  font: inherit;
  text-align: left;
}

.digest-history-list span {
  font-size: var(--type-size-body);
  font-weight: var(--type-weight-semibold);
}

.digest-history-list em {
  min-width: 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-style: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.digest-history-list svg {
  width: 15px;
  height: 15px;
  color: rgba(var(--color-ink-rgb), .32);
}

.sheet-empty-state {
  min-height: 120px;
}
</style>
