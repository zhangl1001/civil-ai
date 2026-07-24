<template>
  <div class="quality-page app-page">
    <PageHeader title="质量追踪" meta="看训练质量、薄弱模块和复习风险">
    </PageHeader>

    <PullToRefresh class="quality-scroll" :on-refresh="load">
      <AppStateView v-if="isLoading" state="loading" title="加载质量追踪" />
      <template v-else-if="dashboard">
        <SurfaceCard as="section" class="quality-hero" variant="strong">
          <div class="hero-score">
            <strong>{{ dashboard.score }}</strong>
            <span>{{ dashboard.grade }}</span>
          </div>
          <div class="hero-copy">
            <b>训练质量指数</b>
            <p>综合题量、正确率、错题复习和连续学习情况，用来判断当前训练是否有效。</p>
          </div>
        </SurfaceCard>

        <section class="metric-grid">
          <SurfaceCard as="article" class="metric-card" compact><strong>{{ dashboard.totalQuestions }}</strong><span>累计题数</span></SurfaceCard>
          <SurfaceCard as="article" class="metric-card" compact><strong>{{ dashboard.practiceDays }}</strong><span>练习天数</span></SurfaceCard>
          <SurfaceCard as="article" class="metric-card" compact><strong>{{ dashboard.streak }}</strong><span>连续打卡</span></SurfaceCard>
          <SurfaceCard as="article" class="metric-card" compact><strong>{{ dashboard.weakestModule?.name || '--' }}</strong><span>薄弱模块</span></SurfaceCard>
        </section>

        <section class="section-group">
          <div class="section-title">
            <strong>能力诊断</strong>
            <span>代码规则计算</span>
          </div>
          <SurfaceCard class="diagnosis-card" compact>
            <p>{{ dashboard.diagnosisSummary }}</p>
            <div class="diagnosis-meta">
              <span>置信度 {{ Math.round(dashboard.diagnosis.overall.confidence * 100) }}%</span>
              <span>每日建议 {{ dashboard.diagnosis.recommendation.dailyQuestionTarget }} 题</span>
              <span>复盘占比 {{ Math.round(dashboard.diagnosis.recommendation.reviewRatio * 100) }}%</span>
            </div>
          </SurfaceCard>
        </section>

        <section class="section-group">
          <div class="section-title">
            <strong>能力结构</strong>
            <span>模块正确率</span>
          </div>
          <SurfaceCard class="panel" compact>
            <div v-if="!dashboard.modules.length" class="inline-empty">完成练习后生成模块能力</div>
            <div v-for="module in dashboard.modules" :key="module.name" class="module-row">
              <span>{{ module.name }}</span>
              <div><i :style="{ width: `${module.accuracy}%` }"></i></div>
              <em>{{ module.accuracy }}%</em>
            </div>
          </SurfaceCard>
        </section>

        <section v-if="dashboard.moduleDiagnoses.length" class="section-group">
          <div class="section-title"><strong>模块诊断</strong><span>优先级排序</span></div>
          <SurfaceCard class="panel" compact>
            <article v-for="item in dashboard.moduleDiagnoses" :key="item.module" class="diagnosis-row">
              <div class="diagnosis-row-main">
                <strong>{{ item.module }}</strong>
                <span>{{ diagnosisTypeText(item.diagnosisType) }} · 优先级 {{ item.priority }}</span>
              </div>
              <div class="diagnosis-tags">
                <em v-for="code in item.reasonCodes" :key="code">{{ reasonText(code) }}</em>
                <em v-if="!item.reasonCodes.length">表现稳定</em>
              </div>
            </article>
          </SurfaceCard>
        </section>

        <section class="section-group">
          <div class="section-title"><strong>正确率趋势</strong><span>最近 7 天</span></div>
          <SurfaceCard class="panel" compact>
            <div class="trend">
              <div v-for="point in dashboard.trend" :key="point.date">
                <i :style="{ height: `${Math.max(6, point.accuracy)}%` }"></i>
                <span>{{ point.date.slice(5) }}</span>
              </div>
            </div>
          </SurfaceCard>
        </section>

        <section class="metric-grid">
          <SurfaceCard as="article" class="metric-card" compact><strong>{{ dashboard.weekQuestions }}</strong><span>本周题数</span></SurfaceCard>
          <SurfaceCard as="article" class="metric-card" compact><strong>{{ dashboard.weekMinutes }}m</strong><span>本周用时</span></SurfaceCard>
          <SurfaceCard as="article" class="metric-card" compact><strong>{{ dashboard.avgSecondsPerQuestion || '--' }}</strong><span>平均秒/题</span></SurfaceCard>
          <SurfaceCard as="article" class="metric-card" compact><strong>{{ dashboard.eventsCount }}</strong><span>学习事件</span></SurfaceCard>
        </section>

        <section class="section-group">
          <div class="section-title"><strong>题目与复习质量</strong></div>
          <SurfaceCard class="panel" compact>
            <div class="quality-row"><ShieldAlertIcon /><div><strong>{{ dashboard.openWrongCount }}</strong><span>待处理错题，越多说明复盘压力越大</span></div></div>
            <div class="quality-row"><RouteIcon /><div><strong>{{ dashboard.reviewDueCount }}</strong><span>已经到复习窗口的错题</span></div></div>
            <div class="quality-row"><ActivityIcon /><div><strong>{{ dashboard.eventsCount }}</strong><span>练习、模考、申论等学习行为</span></div></div>
          </SurfaceCard>
        </section>

        <section class="section-group">
          <div class="section-title"><strong>学习建议</strong></div>
          <SurfaceCard class="panel" compact>
            <p v-for="item in dashboard.advice" :key="item" class="advice">{{ item }}</p>
          </SurfaceCard>
        </section>

        <section class="section-group">
          <div class="section-title">
            <strong>AI 教练洞察</strong>
            <button class="section-action" type="button" :disabled="isGeneratingInsight" @click="generateInsight">
              {{ isGeneratingInsight ? '生成中...' : '生成' }}
            </button>
          </div>
          <SurfaceCard class="panel" compact>
            <MarkdownContent v-if="insight" class="insight-content" :content="insight.content" />
            <div v-else class="inline-empty">基于当前诊断生成一段个性化备考建议</div>
          </SurfaceCard>
        </section>
      </template>
    </PullToRefresh>

    <footer class="app-page-footer footer-actions">
      <button class="primary-button" type="button" @click="startWeakPractice"><TargetIcon /> 按薄弱模块练习</button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ActivityIcon, RouteIcon, ShieldAlertIcon, TargetIcon } from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
import MarkdownContent from '@/components/MarkdownContent.vue';
import { AppStateView, PullToRefresh } from '@/capabilities/design-system/public';
import type { ProfileInsight } from '@/domain/profileAnalysis';
import { profileInsightService } from '@/services/ProfileInsightService';
import { qualityDashboardService, type QualityDashboard } from '@/services/QualityDashboardService';
import type { DiagnosisType } from '@/services/AbilityDiagnosisService';

const router = useRouter();
const dashboard = ref<QualityDashboard | null>(null);
const insight = ref<ProfileInsight | null>(null);
const isLoading = ref(false);
const isGeneratingInsight = ref(false);

onMounted(load);

async function load() {
  isLoading.value = true;
  try {
    dashboard.value = await qualityDashboardService.dashboard();
    insight.value = await profileInsightService.latest('summary') || null;
  } finally {
    isLoading.value = false;
  }
}

async function generateInsight() {
  if (isGeneratingInsight.value) return;
  isGeneratingInsight.value = true;
  try {
    insight.value = await profileInsightService.generate('summary');
  } finally {
    isGeneratingInsight.value = false;
  }
}

function startWeakPractice() {
  qualityDashboardService.startWeakPractice(dashboard.value?.weakestModule?.name);
  router.push('/vue/practice/session');
}

function diagnosisTypeText(type: DiagnosisType): string {
  return {
    insufficient_sample: '样本不足',
    weak_accuracy: '正确率短板',
    slow_speed: '速度偏慢',
    accuracy_and_speed_weak: '正确率和速度双弱',
    unstable: '近期波动',
    review_not_closed: '复盘未闭环',
    stable: '表现稳定'
  }[type];
}

function reasonText(code: string): string {
  return {
    sample_insufficient: '样本不足',
    accuracy_below_target: '低于目标',
    speed_slower_than_target: '耗时偏慢',
    repeat_wrong_high: '重复错题高',
    recent_decline: '近期下滑'
  }[code] || code;
}

</script>

<style scoped>
.quality-page {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.quality-scroll {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 12px;
}
.section-title,.module-row,.quality-row,.footer-actions{display:flex;align-items:center}
.quality-hero {
  min-height: 112px;
  padding: 16px;
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  gap: 14px;
  align-items: center;
}
.hero-score {
  height: 82px;
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(var(--color-brand-rgb), .1);
}
.hero-score strong{display:block;color:var(--primary-color);font-size: var(--type-size-metric);line-height:1}
.hero-score span{display:block;margin-top:3px;color:var(--primary-color);font-size: var(--type-size-caption);font-weight: var(--type-weight-semibold)}
.hero-copy{min-width:0}
.hero-copy b{display:block;color:var(--text-color);font-size: var(--type-size-section-title)}
.hero-copy p{margin:6px 0 0;color:var(--text-secondary-color);font-size: var(--type-size-caption);line-height:1.55;font-weight: var(--type-weight-semibold)}
.diagnosis-card p{margin:0;color:var(--text-color);font-size: var(--type-size-body);font-weight: var(--type-weight-semibold);line-height:1.55}
.diagnosis-meta{margin-top:10px;display:flex;flex-wrap:wrap;gap:7px}
.diagnosis-meta span{padding:4px 8px;border-radius:999px;background:rgba(var(--color-brand-rgb), .1);color:var(--primary-color);font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold)}
.panel{padding:13px}
.section-group{display:flex;flex-direction:column;gap:9px}
.section-title{justify-content:space-between;margin:0}
.section-title strong{font-size: var(--type-size-body-large)}.section-title span{color:var(--text-secondary-color);font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold)}
.section-action{height:28px;border:none;border-radius:999px;padding:0 10px;color:var(--primary-color);background:rgba(var(--color-brand-rgb), .1);font:inherit;font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold)}
.section-action:disabled{opacity:.58}
.inline-empty{padding:14px;color:var(--text-secondary-color);font-size: var(--type-size-secondary);text-align:center}
.module-row{gap:10px;padding:9px 0;border-top:1px solid rgba(var(--color-ink-rgb), .06)}
.module-row span{width:76px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size: var(--type-size-secondary);font-weight: var(--type-weight-semibold)}
.module-row div{flex:1;height:8px;border-radius:4px;overflow:hidden;background:rgba(var(--color-ink-rgb), .08)}
.module-row i{display:block;height:100%;border-radius:4px;background:var(--primary-color)}
.module-row em{width:42px;text-align:right;color:var(--primary-color);font-style:normal;font-weight: var(--type-weight-semibold);font-size: var(--type-size-caption)}
.diagnosis-row{padding:10px 0;border-top:1px solid rgba(var(--color-ink-rgb), .06)}
.diagnosis-row:first-child{border-top:none}
.diagnosis-row-main{display:flex;align-items:center;justify-content:space-between;gap:10px}
.diagnosis-row-main strong{font-size: var(--type-size-secondary)}
.diagnosis-row-main span{color:var(--text-secondary-color);font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold);text-align:right}
.diagnosis-tags{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}
.diagnosis-tags em{padding:3px 7px;border-radius:999px;background:rgba(var(--color-ink-rgb), .06);color:var(--text-secondary-color);font-style:normal;font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold)}
.trend{display:flex;align-items:flex-end;gap:7px;height:96px}
.trend div{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:5px}
.trend i{width:100%;border-radius:5px 5px 0 0;background:var(--primary-color)}
.trend span{color:var(--text-secondary-color);font-size: var(--type-size-micro)}
.metric-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.metric-card{min-height:76px;display:flex;flex-direction:column;justify-content:center}
.metric-card strong,.metric-card span{display:block}
.metric-card strong{font-size: var(--type-size-page-title);line-height:1.15}.metric-card span{margin-top:5px;color:var(--text-secondary-color);font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold)}
.quality-row{gap:10px;padding:10px 0;border-top:1px solid rgba(var(--color-ink-rgb), .06)}
.quality-row svg{width:19px;height:19px;color:var(--primary-color)}
.quality-row strong{display:block;font-size: var(--type-size-section-title)}.quality-row span{color:var(--text-secondary-color);font-size: var(--type-size-micro);font-weight: var(--type-weight-semibold);line-height:1.35}
.advice{margin:8px 0 0;color:var(--text-secondary-color);font-size: var(--type-size-secondary);line-height:1.6}
.insight-content{font-size: var(--type-size-secondary);color:var(--text-color)}
.footer-actions .primary-button{width:100%}.footer-actions svg{width:16px;height:16px}
</style>
