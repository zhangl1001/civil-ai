<template>
  <div class="sprint-page app-page">
    <header class="app-page-header">
      <div class="title-row">
        <button class="icon-button" type="button" @click="goBack"><ArrowLeftIcon /></button>
        <div><h3>考前冲刺</h3><span>薄弱点压缩训练</span></div>
        <span class="header-spacer" aria-hidden="true"></span>
      </div>
    </header>

    <PullToRefresh :on-refresh="load">
      <AppStateView v-if="isLoading" state="loading" title="加载冲刺计划" />
      <template v-else-if="dashboard">
        <section class="hero app-card">
          <strong>{{ dashboard.remainDays ?? '?' }}</strong>
          <span>天距考试</span>
          <p>{{ dashboard.phase }}</p>
          <div class="intensity">
            <button v-for="item in intensities" :key="item.value" :class="{ active: item.value === currentIntensity }" type="button" @click="setIntensity(item.value)">{{ item.label }}</button>
          </div>
        </section>

        <section class="panel app-card">
          <SectionHeading title="今日任务" :meta="`${dashboard.dailyQuestions} 题/日`" />
          <div v-if="!dashboard.todayMission" class="inline-empty">暂无冲刺任务，请先完成练习建立能力画像</div>
          <article v-else class="mission">
            <b>{{ dashboard.todayMission.focusModule }}</b>
            <span>{{ dashboard.todayMission.date }} · 新题 {{ dashboard.todayMission.questionCount - dashboard.todayMission.reviewCount }} · 复习 {{ dashboard.todayMission.reviewCount }}</span>
            <div><em v-for="point in dashboard.todayMission.priorityPoints" :key="point">{{ point }}</em></div>
          </article>
        </section>

        <section class="action-grid">
          <button type="button" class="app-card" @click="startWeakPractice()"><ZapIcon /><strong>弱项突击</strong><span>聚焦薄弱点</span></button>
          <button type="button" class="app-card" @click="router.push('/vue/exam')"><TimerIcon /><strong>限时模考</strong><span>严格计时</span></button>
          <button type="button" class="app-card" @click="router.push('/vue/wrongbook')"><RotateCcwIcon /><strong>错题重做</strong><span>查漏补缺</span></button>
          <button type="button" class="app-card" @click="router.push('/vue/error-report')"><PieChartIcon /><strong>错因报告</strong><span>深度分析</span></button>
        </section>

        <section class="panel app-card">
          <SectionHeading title="薄弱知识点排名" :meta="`${dashboard.weakPoints.length} 项`" />
          <div v-if="!dashboard.weakPoints.length" class="inline-empty">暂无薄弱点数据</div>
          <button v-for="(point, index) in dashboard.weakPoints" :key="`${point.module}-${point.name}`" type="button" class="weak-row" @click="startWeakPractice(point)">
            <i :class="rankTone(point)">{{ index + 1 }}</i>
            <div><strong>{{ point.name }}</strong><span>{{ point.module }}{{ point.dominantError ? ` · ${point.dominantError}` : '' }}</span></div>
            <em>{{ point.proficiency }}%</em>
          </button>
        </section>

        <section v-if="dashboard.emergencyReview.length" class="panel app-card urgent-panel">
          <SectionHeading title="紧急复习" :meta="`${dashboard.emergencyReview.length} 项`" />
          <p v-for="point in dashboard.emergencyReview" :key="`${point.module}-${point.name}`">{{ point.module }} / {{ point.name }}</p>
        </section>
      </template>
    </PullToRefresh>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeftIcon, PieChartIcon, RotateCcwIcon, TimerIcon, ZapIcon } from 'lucide-vue-next';
import { AppStateView, PullToRefresh, SectionHeading } from '@/capabilities/design-system/public';
import { practiceDetailLocation } from '@/features/practice/PracticeNavigation';
import { goBackOrHome } from '@/router/navigation';
import { sprintService, type SprintDashboard, type SprintIntensity, type SprintWeakPoint } from '@/services/SprintService';

const router = useRouter();
const dashboard = ref<SprintDashboard | null>(null);
const isLoading = ref(false);
const currentIntensity = ref<SprintIntensity>('high');
const intensities: Array<{ value: SprintIntensity; label: string }> = [
  { value: 'normal', label: '稳步' },
  { value: 'high', label: '强化' },
  { value: 'extreme', label: '极限' }
];

onMounted(load);

async function load() {
  isLoading.value = true;
  try {
    dashboard.value = await sprintService.dashboard();
    currentIntensity.value = dashboard.value.intensity;
  } finally {
    isLoading.value = false;
  }
}

async function setIntensity(value: SprintIntensity) {
  currentIntensity.value = value;
  dashboard.value = await sprintService.dashboard(value);
}

function rankTone(point: SprintWeakPoint): string {
  if (point.proficiency < 40) return 'urgent';
  if (point.proficiency < 55) return 'warning';
  return 'normal';
}

function startWeakPractice(point?: SprintWeakPoint) {
  const target = point || dashboard.value?.weakPoints[0];
  router.push(practiceDetailLocation({
    mode: 'self',
    module: target?.module,
    knowledgePoint: target?.name
  }));
}

function goBack() {
  goBackOrHome(router);
}
</script>

<style scoped>
.title-row,.weak-row{display:flex;align-items:center}
.title-row{justify-content:space-between;gap:10px}
.header-spacer{width:36px;height:36px;flex:0 0 auto}
.title-row>div{text-align:center;min-width:0}
h3{margin:0;font-size: var(--type-size-section-title)}
.title-row span{display:block;margin-top:2px;color:var(--text-secondary-color);font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold)}
.icon-button svg{width:18px;height:18px}
.hero{margin:16px;padding:18px;background:linear-gradient(135deg,rgba(245,158,11,.16),rgba(255,255,255,.94))}
.hero strong{display:block;color:#d97706;font-size: var(--type-size-display-xlarge);line-height:1}
.hero span{display:block;margin-top:4px;color:var(--text-secondary-color);font-size: var(--type-size-caption);font-weight: var(--type-weight-semibold)}.hero p{margin:8px 0 0;color:#d97706;font-weight: var(--type-weight-semibold)}
.intensity{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px;padding:4px;border-radius:12px;background:rgba(var(--color-ink-rgb), .06)}
.intensity button{height:34px;border:0;border-radius:9px;background:transparent;color:var(--text-secondary-color);font-weight: var(--type-weight-semibold)}.intensity button.active{background:#fff;color:#d97706;box-shadow:0 3px 10px rgba(var(--color-ink-rgb), .08)}
.panel{margin:16px;padding:14px}
.section-heading{margin-bottom:10px}
.inline-empty{padding:14px;color:var(--text-secondary-color);font-size: var(--type-size-secondary);text-align:center}
.mission b,.mission span{display:block}.mission b{font-size: var(--type-size-control)}.mission span{margin-top:4px;color:var(--text-secondary-color);font-size: var(--type-size-caption);font-weight: var(--type-weight-semibold)}.mission div{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.mission em{max-width:100%;padding:5px 8px;border-radius:999px;background:rgba(37,99,235,.1);color:var(--color-brand);font-size: var(--type-size-micro);font-style:normal;font-weight: var(--type-weight-semibold);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.action-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px}
.action-grid button{border:0;text-align:left;padding:14px;background:var(--card-bg-color)}
.action-grid svg{width:22px;height:22px;color:#d97706}.action-grid strong,.action-grid span{display:block}.action-grid strong{margin-top:8px;font-size: var(--type-size-body)}.action-grid span{margin-top:3px;color:var(--text-secondary-color);font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold)}
.weak-row{width:100%;gap:10px;padding:12px 0;border:0;border-top:1px solid rgba(var(--color-ink-rgb), .07);background:transparent;text-align:left}
.weak-row i{width:25px;height:25px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size: var(--type-size-caption);font-style:normal;font-weight: var(--type-weight-semibold);flex-shrink:0}
.weak-row i.urgent{background:rgba(239,68,68,.12);color:#dc2626}.weak-row i.warning{background:rgba(245,158,11,.14);color:#d97706}.weak-row i.normal{background:rgba(37,99,235,.1);color:var(--color-brand)}
.weak-row div{min-width:0;flex:1}.weak-row strong,.weak-row span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.weak-row strong{font-size: var(--type-size-secondary)}.weak-row span{margin-top:2px;color:var(--text-secondary-color);font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold)}
.weak-row em{color:#d97706;font-size: var(--type-size-secondary);font-style:normal;font-weight: var(--type-weight-semibold)}
.urgent-panel p{margin:8px 0 0;color:var(--text-secondary-color);font-size: var(--type-size-secondary)}
</style>
