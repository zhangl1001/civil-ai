<template>
  <div class="monthly-page app-page">
    <header class="app-page-header">
      <div class="title-row">
        <button class="icon-button" type="button" @click="goBack">
          <ArrowLeftIcon />
        </button>
        <div>
          <h3>时政月报</h3>
          <span>{{ selected.year }}年{{ selected.month }}月</span>
        </div>
        <span class="header-spacer" aria-hidden="true"></span>
      </div>

      <section class="hero">
        <div>
          <NewspaperIcon />
          <strong>{{ selected.year }}年{{ selected.month }}月</strong>
        </div>
        <span>{{ dashboard?.itemCount ? `${dashboard.itemCount} 条热点 · ${dashboard.categories.length} 个分类` : '时政热点汇总' }}</span>
      </section>

      <div class="month-selector">
        <button
          v-for="month in months"
          :key="month.key"
          type="button"
          :class="{ active: month.key === selected.key }"
          @click="selectMonth(month.year, month.month)"
        >
          {{ month.label }}
        </button>
      </div>
    </header>

    <PullToRefresh :on-refresh="loadDashboard">
      <AppStateView v-if="isLoading" state="loading" title="加载时政月报" />

      <AppStateView v-else-if="!dashboard?.itemCount" title="本月暂无时政热点" description="先生成每日热点，月报会自动按月份汇总。">
        <template #actions>
          <button class="primary-button" type="button" @click="router.push('/vue/digest')">生成每日热点</button>
        </template>
      </AppStateView>

      <template v-else>
        <article v-if="dashboard.reportContent" class="monthly-report app-card">
          <div class="category-title">
            <div class="category-icon purple"><SparklesIcon /></div>
            <strong>AI 月度复盘</strong>
            <span>已生成</span>
          </div>
          <MarkdownContent :content="dashboard.reportContent" />
        </article>

        <section v-for="category in dashboard.categories" :key="category.name" class="category">
          <div class="category-title">
            <div class="category-icon" :class="categoryClass(category.name)">
              <component :is="categoryIcon(category.name)" />
            </div>
            <strong>{{ category.name }}</strong>
            <span>{{ category.count }} 条</span>
          </div>

          <article v-for="item in category.items" :key="item.id" class="news-card app-card">
            <div class="tag-row">
              <span v-for="tag in item.tags" :key="tag" class="news-tag" :class="categoryClass(item.category)">{{ tag }}</span>
            </div>
            <h4>{{ item.title }}</h4>
            <p v-if="item.summary">{{ item.summary }}</p>
            <footer>
              <span>{{ item.date }}</span>
              <span>{{ item.source || '每日热点' }}</span>
            </footer>
          </article>
        </section>
      </template>
    </PullToRefresh>

    <footer class="app-page-footer footer-actions">
      <button class="secondary-button report-button" type="button" :disabled="isGeneratingReport || !dashboard?.itemCount" @click="generateReport">
        <SparklesIcon />
        {{ isGeneratingReport ? '生成中' : 'AI月报' }}
      </button>
      <button class="primary-button" type="button" @click="startPractice">
        <PenToolIcon />
        时政练习
      </button>
      <button class="secondary-button" type="button" @click="router.push('/vue/digest')">
        <SparklesIcon />
        每日热点
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, type Component } from 'vue';
import { useRouter } from 'vue-router';
import {
  ArrowLeftIcon,
  BriefcaseBusinessIcon,
  CpuIcon,
  GlobeIcon,
  LandmarkIcon,
  LayersIcon,
  NewspaperIcon,
  PenToolIcon,
  ScaleIcon,
  SparklesIcon,
  UsersIcon
} from 'lucide-vue-next';
import { goBackOrHome } from '@/router/navigation';
import { AppStateView, PullToRefresh } from '@/capabilities/design-system/public';
import { practiceDetailLocation } from '@/features/practice/PracticeNavigation';
import MarkdownContent from '@/components/MarkdownContent.vue';
import { monthlyDigestService, type MonthlyDigestDashboard } from '@/services/MonthlyDigestService';

const router = useRouter();
const current = monthlyDigestService.currentMonth();
const selected = ref({ ...current, key: `${current.year}-${String(current.month).padStart(2, '0')}` });
const months = monthlyDigestService.recentMonths(6);
const dashboard = ref<MonthlyDigestDashboard | null>(null);
const isLoading = ref(false);
const isGeneratingReport = ref(false);

onMounted(loadDashboard);

async function loadDashboard() {
  isLoading.value = true;
  try {
    dashboard.value = await monthlyDigestService.dashboard(selected.value.year, selected.value.month);
  } finally {
    isLoading.value = false;
  }
}

async function selectMonth(year: number, month: number) {
  selected.value = { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
  await loadDashboard();
}

function startPractice() {
  router.push(practiceDetailLocation({
    mode: 'self',
    module: '常识判断',
    knowledgePoint: '时政热点'
  }));
}

async function generateReport() {
  if (!dashboard.value?.itemCount || isGeneratingReport.value) return;
  isGeneratingReport.value = true;
  try {
    await monthlyDigestService.enqueueReport(selected.value.year, selected.value.month);
  } finally {
    isGeneratingReport.value = false;
  }
}

function goBack() {
  goBackOrHome(router);
}

function categoryClass(name: string): string {
  if (name === '政治' || name === '法律') return 'red';
  if (name === '经济') return 'orange';
  if (name === '科技') return 'purple';
  if (name === '文化') return 'green';
  if (name === '外交') return 'blue';
  if (name === '社会') return 'teal';
  return 'blue';
}

function categoryIcon(name: string) {
  const map: Record<string, Component> = {
    政治: LandmarkIcon,
    经济: BriefcaseBusinessIcon,
    社会: UsersIcon,
    科技: CpuIcon,
    文化: NewspaperIcon,
    法律: ScaleIcon,
    外交: GlobeIcon,
    综合: LayersIcon
  };
  return map[name] || LayersIcon;
}
</script>

<style scoped>
.title-row,
.hero div,
.category-title,
.footer-actions,
.news-card footer {
  display: flex;
  align-items: center;
}

.title-row {
  justify-content: space-between;
  gap: 10px;
}

.header-spacer {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
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

.hero {
  margin-top: 14px;
  border: 1px solid rgba(var(--color-ink-rgb), .06);
  border-radius: 14px;
  padding: 14px;
  background: rgba(255, 255, 255, .72);
}

.monthly-report {
  margin-bottom: 16px;
}

.hero div {
  gap: 8px;
}

.hero svg {
  width: 21px;
  height: 21px;
  color: var(--primary-color);
}

.hero strong {
  font-size: var(--type-size-section-title);
}

.hero span {
  display: block;
  margin-top: 5px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.month-selector {
  display: flex;
  gap: 7px;
  margin-top: 12px;
  overflow-x: auto;
  padding-bottom: 2px;
  -webkit-overflow-scrolling: touch;
}

.month-selector button {
  flex: 0 0 auto;
  height: 34px;
  border: 1px solid rgba(var(--color-ink-rgb), .08);
  border-radius: 17px;
  padding: 0 15px;
  background: rgba(255, 255, 255, .74);
  color: var(--text-secondary-color);
  font: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}

.month-selector button.active {
  border-color: rgba(var(--color-brand-rgb), .3);
  background: rgba(var(--color-brand-rgb), .1);
  color: var(--primary-color);
}

.category {
  margin: 16px 16px 18px;
}

.category-title {
  gap: 8px;
  margin-bottom: 9px;
}

.category-icon {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.category-icon svg {
  width: 15px;
  height: 15px;
}

.category-title strong {
  font-size: var(--type-size-body-large);
}

.category-title span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.news-card {
  margin-top: 9px;
  padding: 14px;
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.news-tag {
  height: 22px;
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  padding: 0 9px;
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.news-card h4 {
  margin: 9px 0 6px;
  font-size: var(--type-size-body);
  line-height: 1.5;
}

.news-card p {
  margin: 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  line-height: 1.6;
}

.news-card footer {
  justify-content: space-between;
  margin-top: 9px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.red { background: rgba(229, 57, 53, .1); color: #d93025; }
.orange { background: rgba(245, 124, 0, .12); color: #ef6c00; }
.blue { background: rgba(var(--color-brand-rgb), .1); color: var(--primary-color); }
.purple { background: rgba(126, 87, 194, .12); color: #6f42c1; }
.green { background: rgba(46, 125, 50, .12); color: #2e7d32; }
.teal { background: rgba(0, 137, 123, .12); color: #00897b; }

.footer-actions {
  gap: 8px;
}

.primary-button,
.secondary-button {
  min-width: 0;
}

.footer-actions .primary-button {
  flex: 1.2;
}

.secondary-button {
  flex: 1;
  height: 44px;
  border: none;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(var(--color-ink-rgb), .07);
  color: var(--text-secondary-color);
  font-size: var(--type-size-body);
  font-weight: var(--type-weight-semibold);
}

.report-button {
  flex: 1;
}

.footer-actions svg {
  width: 16px;
  height: 16px;
}
</style>
