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

      <div class="mode-tabs">
        <button type="button" :class="{ active: tab === 'news' }" @click="switchTab('news')">热点</button>
        <button type="button" :class="{ active: tab === 'tips' }" @click="switchTab('tips')">知识点</button>
      </div>
    </PageHeader>

    <PullToRefresh :on-refresh="loadDashboard">
      <AppStateView v-if="isLoading" state="loading" title="加载每日积累" />

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
        <section class="toolbar app-card">
          <div>
            <span>{{ tab === 'news' ? '今日热点' : '今日知识点' }}</span>
            <strong>{{ sections.length }} 个条目</strong>
          </div>
          <button type="button" :disabled="isGenerating" @click="generate">
            <SparklesIcon />
            重新生成
          </button>
        </section>

        <article v-for="section in sections" :key="section.id" class="digest-card app-card">
          <span class="digest-tag" :class="tab">{{ tab === 'news' ? '热点' : '知识点' }}</span>
          <h4>{{ section.title }}</h4>
          <p>{{ compactBody(section.body) }}</p>
        </article>
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
import { computed, onMounted, ref } from 'vue';
import {
  ChevronRightIcon,
  HistoryIcon,
  SparklesIcon,
  Trash2Icon
} from 'lucide-vue-next';
import { AppStateView, PullToRefresh } from '@/capabilities/design-system/public';
import PageHeader from '@/components/layout/PageHeader.vue';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import ConfirmDialog from '@/components/layout/ConfirmDialog.vue';
import HeaderMoreMenu from '@/components/layout/HeaderMoreMenu.vue';
import type { DigestTab } from '@/domain/digest';
import { digestService, type DigestDashboard } from '@/services/DigestService';
import { useTasksStore } from '@/stores/tasks';

const tasksStore = useTasksStore();

const tab = ref<DigestTab>(digestService.readActiveTab());
const date = ref(localDate());
const dashboard = ref<DigestDashboard | null>(null);
const isLoading = ref(false);
const isGenerating = ref(false);
const showHistorySheet = ref(false);
const showDeleteConfirm = ref(false);
const notice = ref('');

const sections = computed(() => dashboard.value?.sections || []);
const history = computed(() => dashboard.value?.history || []);
const historyGroups = computed(() => {
  const grouped = new Map<string, typeof history.value>();
  history.value.forEach((item) => {
    const month = item.date.slice(0, 7);
    grouped.set(month, [...(grouped.get(month) || []), item]);
  });
  return Array.from(grouped.entries()).map(([month, items]) => ({ month, items }));
});

onMounted(loadDashboard);

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
  tab.value = next;
  date.value = localDate();
  digestService.writeActiveTab(next);
  await loadDashboard();
}

async function generate() {
  isGenerating.value = true;
  notice.value = '';
  try {
    const result = await digestService.enqueueGenerate(tab.value, date.value);
    await tasksStore.refresh();
    notice.value = result.reused ? '已有相同内容生成任务在执行。' : '生成任务已加入任务栏。';
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '生成任务派发失败';
  } finally {
    isGenerating.value = false;
  }
}

async function openHistory(nextDate: string) {
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

function compactBody(body: string): string {
  return body
    .replace(/^[-*]\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
</script>

<style scoped>
.title-row,
.toolbar {
  display: flex;
  align-items: center;
}

.title-row {
  justify-content: space-between;
  gap: 10px;
}

.title-row > div {
  min-width: 0;
  text-align: center;
}

h3 {
  margin: 0;
  font-size: var(--type-size-section-title);
}

.title-row span {
  display: block;
  margin-top: 2px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.icon-button svg {
  width: 18px;
  height: 18px;
}

.mode-tabs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  margin-top: 14px;
  padding: 4px;
  border-radius: 12px;
  background: rgba(var(--color-ink-rgb), .06);
}

.mode-tabs button {
  height: 34px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-secondary-color);
  font: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}

.mode-tabs button.active {
  background: rgba(255, 255, 255, .94);
  color: var(--primary-color);
  box-shadow: 0 5px 14px rgba(28, 38, 58, .08);
}

.guide {
  min-height: 320px;
  margin: 16px;
  padding: 24px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
}

.guide > svg {
  width: 42px;
  height: 42px;
  color: var(--primary-color);
}

.guide strong {
  font-size: var(--type-size-section-title);
}

.guide p {
  max-width: 280px;
  margin: 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  line-height: 1.6;
}

.notice {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
}

.toolbar {
  justify-content: space-between;
  gap: 12px;
  margin: 14px 16px 10px;
  padding: 14px;
}

.toolbar span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.toolbar strong {
  display: block;
  margin-top: 3px;
  font-size: var(--type-size-control);
}

.toolbar button {
  flex-shrink: 0;
  height: 34px;
  border: none;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 12px;
  background: rgba(var(--color-brand-rgb), .1);
  color: var(--primary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.toolbar svg,
.primary-button svg {
  width: 15px;
  height: 15px;
}

.digest-card {
  margin: 10px 16px;
  padding: 15px;
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
  margin: 10px 0 8px;
  font-size: var(--type-size-control);
}

.digest-card p {
  margin: 0;
  white-space: pre-line;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  line-height: 1.7;
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
