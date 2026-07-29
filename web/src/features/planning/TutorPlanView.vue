<template>
  <div class="tutor-plan-page app-page">
    <PageHeader title="今日计划" :meta="cycleLabel" />

    <PullToRefresh class="tutor-plan-content" :on-refresh="load">
      <InitialRefreshState v-if="loading" label="正在刷新计划" />
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
              <span class="item-copy">
                <strong>{{ actionLabel(item.itemType) }} · {{ capabilityName(item.capabilityNodeId) }}</strong>
                <em>{{ item.targetMinutes }} 分钟{{ item.targetCount ? ` · ${item.targetCount} 题` : '' }}{{ statusLabel(item.status) }}</em>
                <small v-if="item.failureMessage">{{ item.failureMessage }}</small>
              </span>
              <ChevronRightIcon />
            </button>
            <button v-if="item.status === 'pending' || item.status === 'in_progress'" class="plan-item-skip" type="button" aria-label="取消计划项" @click="cancelTarget = item">
              <BanIcon />
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
    <ConfirmDialog
      :model-value="Boolean(cancelTarget)"
      title="取消这项安排"
      description="本次只取消当前计划项，不会删除已产生的练习和能力记录。"
      confirm-text="取消计划项"
      tone="danger"
      @confirm="cancelItem"
      @update:model-value="(value) => { if (!value) cancelTarget = undefined; }"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { BanIcon, BookOpenIcon, CalendarCheckIcon, ChevronRightIcon, Clock3Icon, RotateCcwIcon, SparklesIcon, TargetIcon } from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
import ConfirmDialog from '@/components/layout/ConfirmDialog.vue';
import { AppStateView, InitialRefreshState, PullToRefresh } from '@/capabilities/design-system/public';
import { initializeTutorRuntime } from '@/composition-root/public';
import type { CapabilityNodeId } from '@/kernel/public';
import type { DailyPlanAggregate, DailyPlanItemRecord } from '@/modules/planning/public';
import { dailyPlanItemLocation } from './DailyPlanNavigation';
import { PlanFeature } from './PlanFeature';

const router = useRouter();
const loading = ref(true); const generating = ref(false); const error = ref('');
const plan = ref<DailyPlanAggregate>(); const names = ref(new Map<string, string>()); const cycleLabel = ref('备考计划');
const localDate = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
const availableMinutes = ref(30);
const openingItemId = ref('');
const cancelTarget = ref<DailyPlanItemRecord>();
let planFeaturePromise: Promise<PlanFeature> | undefined;

onMounted(() => { void load(); });

async function load() {
  loading.value = true; error.value = '';
  try {
    const state = await (await feature()).load();
    cycleLabel.value = state.cycleLabel;
    availableMinutes.value = state.availableMinutes;
    names.value = state.capabilityNames;
    plan.value = state.plan;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取计划失败'; }
  finally { loading.value = false; }
}

async function generate() {
  if (generating.value) return;
  generating.value = true; error.value = '';
  try {
    plan.value = await (await feature()).generate(availableMinutes.value);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '生成计划失败'; }
  finally { generating.value = false; }
}

function capabilityName(id: CapabilityNodeId): string { return names.value.get(id) || '待诊断能力点'; }
function actionLabel(type: DailyPlanItemRecord['itemType']): string {
  if (type === 'lecture') return '知识讲解';
  if (type === 'guided_practice') return '引导练习';
  if (type === 'independent_practice') return '独立练习';
  if (type === 'review') return '间隔复习';
  if (type === 'transfer') return '迁移训练';
  if (type === 'diagnosis') return '能力诊断';
  if (type === 'variant') return '变式训练';
  if (type === 'timed') return '限时训练';
  if (type === 'mock') return '模拟测评';
  if (type === 'essay') return '申论训练';
  return '每日积累';
}
function statusLabel(status: DailyPlanItemRecord['status']): string { return { pending: '', in_progress: ' · 进行中', completed: ' · 已完成', skipped: ' · 已跳过', cancelled: ' · 已取消' }[status]; }
function iconFor(type: DailyPlanItemRecord['itemType']) {
  if (type === 'lecture') return BookOpenIcon;
  if (type === 'review') return RotateCcwIcon;
  if (type === 'transfer' || type === 'digest') return SparklesIcon;
  if (type === 'independent_practice' || type === 'timed') return Clock3Icon;
  return TargetIcon;
}
async function openItem(item: DailyPlanItemRecord) {
  if (openingItemId.value) return;
  openingItemId.value = item.id; error.value = '';
  try {
    await router.push(dailyPlanItemLocation(item));
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '打开计划项失败'; }
  finally { openingItemId.value = ''; }
}

async function cancelItem() {
  const item = cancelTarget.value;
  if (!item) return;
  cancelTarget.value = undefined;
  const updated = await (await feature()).cancel(item.id);
  if (updated && plan.value) {
    plan.value = { ...plan.value, items: plan.value.items.map((current) => current.id === updated.id ? updated : current) };
  }
}
function feature(): Promise<PlanFeature> {
  planFeaturePromise ??= initializeTutorRuntime().then((runtime) => new PlanFeature(runtime));
  return planFeaturePromise;
}
</script>

<style scoped>
.tutor-plan-content { display:flex; flex-direction:column; gap:16px; padding-top:12px; }
.plan-summary { padding:18px 16px 16px; border-radius:8px; background:rgba(var(--color-brand-rgb),.065); }.plan-summary span { color:var(--text-secondary-color); font-size:var(--type-size-caption); }.plan-summary strong { display:block; margin-top:5px; font-size:var(--type-size-body-large); }.plan-summary p { margin:7px 0 0; color:var(--text-secondary-color); font-size:var(--type-size-secondary); line-height:1.5; }
.plan-list { overflow:hidden; border-radius:8px; background:rgba(var(--color-surface-rgb),.55); }.plan-item { width:100%; min-height:66px; display:flex; align-items:center; gap:4px; border-top:1px solid rgba(var(--color-ink-rgb),.055); color:inherit; background:transparent; }.plan-item:first-child { border-top:0; }.plan-item.completed,.plan-item.skipped { opacity:.68; }.plan-item.in_progress .item-icon { color:var(--orange-color); background:rgba(255,149,0,.12); }.plan-item.completed .item-icon { color:var(--green-color); background:rgba(52,199,89,.12); }.plan-item.skipped .item-icon { color:var(--text-secondary-color); background:rgba(var(--color-ink-rgb),.06); }.plan-item-main { min-width:0; min-height:66px; flex:1; display:flex; align-items:center; gap:11px; padding:10px 8px 10px 12px; border:0; color:inherit; background:transparent; text-align:left; }.plan-item-main:disabled { opacity:.72; }.plan-item-main>svg { width:16px; color:var(--text-secondary-color); }.plan-item-skip { width:38px; height:38px; margin-right:8px; display:grid; place-items:center; border:0; border-radius:50%; color:var(--text-secondary-color); background:transparent; }.plan-item-skip svg { width:17px; height:17px; }.item-icon { width:38px; height:38px; display:grid; place-items:center; border-radius:11px; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.1); flex:0 0 auto; }.item-icon svg { width:18px; height:18px; }.item-icon.review { color:var(--orange-color); background:rgba(255,149,0,.12); }.item-icon.transfer { color:var(--green-color); background:rgba(52,199,89,.12); }.item-copy { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; }.item-copy strong,.item-copy em { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }.item-copy strong { font-size:var(--type-size-body); }.item-copy em { color:var(--text-secondary-color); font-size:var(--type-size-caption); font-style:normal; }
.item-copy small { overflow:hidden; color:var(--red-color); font-size:var(--type-size-caption); font-weight:400; white-space:nowrap; text-overflow:ellipsis; }
.plan-create-button { min-height:40px; margin-top:5px; display:inline-flex; align-items:center; gap:7px; padding:0 14px; border:0; border-radius:10px; color:#fff; background:var(--primary-color); font:inherit; font-size:var(--type-size-secondary); }.plan-create-button:disabled { opacity:.5; }
</style>
