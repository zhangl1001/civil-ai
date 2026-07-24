<template>
  <div class="tutor-plan-page app-page">
    <PageHeader title="今日计划" :meta="cycleLabel">
      <template #actions>
        <button class="header-action" type="button" :disabled="generating" @click="generate">
          <RefreshCwIcon :class="{ spinning: generating }" />
        </button>
      </template>
    </PageHeader>

    <PullToRefresh class="tutor-plan-content" :on-refresh="load">
      <AppStateView v-if="loading" state="loading" title="正在读取计划" />
      <AppStateView v-else-if="error" state="error" title="计划暂不可用" :description="error" action-label="重试" @action="load" />
      <template v-else>
        <section class="plan-summary">
          <span>{{ localDate }}</span>
          <strong>{{ plan ? `${plan.plan.availableMinutes} 分钟专注训练` : `${availableMinutes} 分钟可用时间` }}</strong>
          <p>{{ plan?.plan.decisionSummary || '先根据真实练习和复习状态生成一份可执行计划。' }}</p>
        </section>

        <section v-if="plan" class="plan-list" aria-label="今日学习任务">
          <article v-for="item in plan.items" :key="item.id" :class="['plan-item', item.status]">
            <button class="plan-item-main" type="button" :disabled="openingItemId === item.id || item.status === 'completed' || item.status === 'skipped'" @click="openItem(item)">
              <span :class="['item-icon', item.itemType]"><component :is="iconFor(item.itemType)" /></span>
              <span class="item-copy"><strong>{{ actionLabel(item.itemType) }} · {{ capabilityName(item.capabilityNodeId) }}</strong><em>{{ item.targetMinutes }} 分钟{{ item.targetCount ? ` · ${item.targetCount} 题` : '' }}{{ statusLabel(item.status) }}</em></span>
              <ChevronRightIcon />
            </button>
            <button v-if="item.reviewQueueItemId && (item.status === 'pending' || item.status === 'in_progress')" class="plan-item-skip" type="button" aria-label="跳过计划项" @click="skipItem(item)">
              <XCircleIcon />
            </button>
          </article>
        </section>

        <AppStateView v-else title="还没有今日计划" description="计划会优先安排到期复习，再处理当前最需要提升的能力点。">
          <template #icon><CalendarCheckIcon /></template>
          <template #actions>
            <button class="plan-create-button" type="button" :disabled="generating" @click="generate"><SparklesIcon /> {{ generating ? '生成中...' : '生成今日计划' }}</button>
          </template>
        </AppStateView>
      </template>
    </PullToRefresh>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { BookOpenIcon, CalendarCheckIcon, ChevronRightIcon, Clock3Icon, RefreshCwIcon, RotateCcwIcon, SparklesIcon, TargetIcon, XCircleIcon } from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
import { AppStateView, PullToRefresh } from '@/capabilities/design-system/public';
import { createConfiguredProviderGateway, initializeTutorRuntime } from '@/composition-root/public';
import type { CapabilityNodeId, LocalDate } from '@/kernel/public';
import type { DailyPlanAggregate, DailyPlanItemRecord } from '@/modules/planning/public';
import { ReviewPracticeFeature } from '@/features/practice/ReviewPracticeFeature';

const router = useRouter();
const loading = ref(true); const generating = ref(false); const error = ref('');
const plan = ref<DailyPlanAggregate>(); const names = ref(new Map<string, string>()); const cycleLabel = ref('备考计划');
const localDate = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
const availableMinutes = ref(30);
const openingItemId = ref('');

onMounted(() => { void load(); });

async function load() {
  loading.value = true; error.value = '';
  try {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    cycleLabel.value = cycle.project.name;
    const weekday = new Date().getDay();
    availableMinutes.value = weekday === 0 || weekday === 6 ? cycle.studyConstraints.weekendMinutes : cycle.studyConstraints.weekdayMinutes;
    const curriculum = await runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId);
    names.value = new Map(curriculum?.capabilityNodes.map((node) => [node.id, node.name]) ?? []);
    plan.value = await runtime.dailyPlanRepository.findCurrent(cycle.examCycle.id, dateKey());
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取计划失败'; }
  finally { loading.value = false; }
}

async function generate() {
  if (generating.value) return;
  generating.value = true; error.value = '';
  try {
    const runtime = await initializeTutorRuntime(); const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const proposal = await runtime.buildDailyPlanProposal.execute({ examCycleId: cycle.examCycle.id, availableMinutes: Math.max(5, availableMinutes.value) });
    plan.value = await runtime.persistDailyPlanProposal.execute({ proposal, planDate: dateKey(), phase: cycle.examCycle.phase });
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '生成计划失败'; }
  finally { generating.value = false; }
}

function dateKey(): LocalDate { return new Date().toLocaleDateString('en-CA') as LocalDate; }
function capabilityName(id: CapabilityNodeId): string { return names.value.get(id) || '待诊断能力点'; }
function actionLabel(type: DailyPlanItemRecord['itemType']): string { return { lecture: '知识讲解', guided_practice: '引导练习', independent_practice: '独立练习', review: '间隔复习', transfer: '迁移训练' }[type]; }
function statusLabel(status: DailyPlanItemRecord['status']): string { return { pending: '', in_progress: ' · 进行中', completed: ' · 已完成', skipped: ' · 已跳过', cancelled: ' · 已取消' }[status]; }
function iconFor(type: DailyPlanItemRecord['itemType']) { return { lecture: BookOpenIcon, guided_practice: TargetIcon, independent_practice: Clock3Icon, review: RotateCcwIcon, transfer: SparklesIcon }[type]; }
async function openItem(item: DailyPlanItemRecord) {
  if (openingItemId.value) return;
  openingItemId.value = item.id; error.value = '';
  try {
    if (item.itemType !== 'review' || !item.reviewQueueItemId) { await router.push('/vue/practice'); return; }
    const runtime = await initializeTutorRuntime();
    const result = await new ReviewPracticeFeature(runtime).start(item.reviewQueueItemId as Parameters<ReviewPracticeFeature['start']>[0], await createConfiguredProviderGateway());
    await router.push({ path: '/vue/practice/objective-session', query: { questionSetId: result.questionSetId, learningThreadId: result.thread.id, reviewQueueItemId: result.review.id } });
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '启动复习失败'; }
  finally { openingItemId.value = ''; }
}

async function skipItem(item: DailyPlanItemRecord) {
  if (!item.reviewQueueItemId) return;
  const runtime = await initializeTutorRuntime();
  const updated = await runtime.updateDailyPlanItemStatus.execute({ reviewQueueItemId: item.reviewQueueItemId, status: 'skipped' });
  if (updated && plan.value) {
    plan.value = { ...plan.value, items: plan.value.items.map((current) => current.id === updated.id ? updated : current) };
  }
}
</script>

<style scoped>
.tutor-plan-content { display:flex; flex-direction:column; gap:16px; padding-top:12px; }
.header-action { width:36px; height:36px; display:grid; place-items:center; border:0; border-radius:50%; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.1); }
.header-action svg { width:17px; height:17px; }.spinning { animation:spin .8s linear infinite; }@keyframes spin { to { transform:rotate(360deg); } }
.plan-summary { padding:18px 16px 16px; border-radius:8px; background:rgba(var(--color-brand-rgb),.065); }.plan-summary span { color:var(--text-secondary-color); font-size:var(--type-size-caption); }.plan-summary strong { display:block; margin-top:5px; font-size:var(--type-size-body-large); }.plan-summary p { margin:7px 0 0; color:var(--text-secondary-color); font-size:var(--type-size-secondary); line-height:1.5; }
.plan-list { overflow:hidden; border-radius:8px; background:rgba(var(--color-surface-rgb),.55); }.plan-item { width:100%; min-height:66px; display:flex; align-items:center; gap:4px; border-top:1px solid rgba(var(--color-ink-rgb),.055); color:inherit; background:transparent; }.plan-item:first-child { border-top:0; }.plan-item.completed,.plan-item.skipped { opacity:.68; }.plan-item.in_progress .item-icon { color:var(--orange-color); background:rgba(255,149,0,.12); }.plan-item.completed .item-icon { color:var(--green-color); background:rgba(52,199,89,.12); }.plan-item.skipped .item-icon { color:var(--text-secondary-color); background:rgba(var(--color-ink-rgb),.06); }.plan-item-main { min-width:0; min-height:66px; flex:1; display:flex; align-items:center; gap:11px; padding:10px 8px 10px 12px; border:0; color:inherit; background:transparent; text-align:left; }.plan-item-main:disabled { opacity:.72; }.plan-item-main>svg { width:16px; color:var(--text-secondary-color); }.plan-item-skip { width:38px; height:38px; margin-right:8px; display:grid; place-items:center; border:0; border-radius:50%; color:var(--text-secondary-color); background:transparent; }.plan-item-skip svg { width:17px; height:17px; }.item-icon { width:38px; height:38px; display:grid; place-items:center; border-radius:11px; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.1); flex:0 0 auto; }.item-icon svg { width:18px; height:18px; }.item-icon.review { color:var(--orange-color); background:rgba(255,149,0,.12); }.item-icon.transfer { color:var(--green-color); background:rgba(52,199,89,.12); }.item-copy { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; }.item-copy strong,.item-copy em { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }.item-copy strong { font-size:var(--type-size-body); }.item-copy em { color:var(--text-secondary-color); font-size:var(--type-size-caption); font-style:normal; }
.plan-create-button { min-height:40px; margin-top:5px; display:inline-flex; align-items:center; gap:7px; padding:0 14px; border:0; border-radius:10px; color:#fff; background:var(--primary-color); font:inherit; font-size:var(--type-size-secondary); }.plan-create-button:disabled,.header-action:disabled { opacity:.5; }
</style>
