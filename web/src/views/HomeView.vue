<template>
  <div class="home-page app-page">
    <PageHeader
      :level="1"
      :title="candidateHome?.projectName || 'AI 私教备考'"
      :meta="candidateHome ? cycleSubtitle : '建立档案后开始个性化训练'"
    >
      <template #actions>
        <button class="icon-button" type="button" @click="router.push('/vue/calendar')"><CalendarIcon /></button>
      </template>
    </PageHeader>

    <PullToRefresh class="home-scroll" :on-refresh="refreshTutorHome">
      <div v-if="isTutorLoading && !candidateHome" class="loading-skeleton">
        <div class="skeleton-card hero"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
      </div>

      <div v-else class="home-content">
        <AppStateView
          v-if="tutorLoadError && !candidateHome"
          state="error"
          title="备考档案暂时无法读取"
          :description="tutorLoadError"
          action-label="重新加载"
          @action="loadTutorHome"
        />

        <section v-else-if="!candidateHome" class="onboarding-card">
          <div>
            <span>备考建档</span>
            <strong>先建立你的目标和现状</strong>
            <p>后续计划、生题、批改和能力分析都会围绕这份备考档案运行。</p>
          </div>
          <button type="button" @click="router.push('/vue/onboarding')">开始建档</button>
        </section>

        <template v-else>
          <section class="tutor-hero">
            <div class="hero-copy">
              <div class="hero-heading">
                <span>今日私教判断</span>
              </div>
              <strong>{{ tutorDecisionTitle }}</strong>
              <p>{{ tutorDecisionDetail }}</p>
            </div>
            <button
              class="hero-meter"
              type="button"
              :aria-label="`查看${heroMetric.label}的判断依据`"
              @click="router.push('/vue/quality-dashboard')"
            >
              <strong>{{ heroMetric.value }}</strong>
              <span>{{ heroMetric.label }}</span>
            </button>
            <small class="hero-evidence">{{ tutorDecisionEvidence }}</small>
            <div class="hero-actions">
              <button class="primary-action" type="button" @click="router.push(primaryTutorAction.to)">
                <component :is="primaryTutorAction.icon" />
                {{ primaryTutorAction.name }}
              </button>
              <button type="button" @click="router.push('/vue/plan')">
                <SparklesIcon />
                每日计划
              </button>
            </div>
          </section>

          <section v-if="!hasReliableAbilityProfile" class="baseline-card">
            <div>
              <span>能力校准</span>
              <strong>先补齐可信样本，再判断薄弱点</strong>
              <p>当前累计 {{ quality?.totalQuestions || 0 }} 题。系统不会用少量作答给你下确定结论。</p>
            </div>
            <button type="button" @click="router.push(primaryTutorAction.to)">开始校准</button>
          </section>

          <HomeActionGrid />

          <section v-if="weakModules.length" class="section-group">
            <SectionHeading title="薄弱点与训练优先级">
              <template #action>
                <button type="button" @click="router.push('/vue/knowledge-graph')">知识地图</button>
              </template>
            </SectionHeading>
            <div v-if="weakModules.length" class="weak-list">
              <button v-for="(item, index) in weakModules" :key="item.code" type="button" class="weak-row" @click="startWeakPractice(item.code)">
                <i>{{ index + 1 }}</i>
                <span>
                  <strong>{{ item.name }}</strong>
                  <em>{{ item.total }} 题样本 · 正确率 {{ item.accuracy }}%</em>
                </span>
                <ChevronRightIcon />
              </button>
            </div>
          </section>

          <section v-if="hasReliableAbilityProfile" class="section-group">
            <SectionHeading title="个人能力画像">
              <template #action>
                <button type="button" @click="router.push('/vue/quality-dashboard')">完整报告</button>
              </template>
            </SectionHeading>
            <div class="portrait-section">
              <div class="score-grid">
                <article v-for="score in scoreRows" :key="score.subject" class="score-card">
                  <span>{{ score.label }}</span>
                  <strong>{{ score.current }}</strong>
                  <em>{{ score.currentMeta }} · 目标 {{ score.target }}</em>
                  <b :class="score.tone">{{ score.gapText }}</b>
                </article>
              </div>
              <div class="ability-chart-card">
                <div class="chart-head">
                  <strong>能力雷达</strong>
                  <span>{{ radarModules.length ? '模块正确率' : '等待练习样本' }}</span>
                </div>
                <div v-if="radarEvidenceCount >= 3" class="radar-panel">
                  <svg class="ability-radar" viewBox="0 0 200 200" role="img" aria-label="能力雷达图">
                    <polygon v-for="ring in radarGridPolygons" :key="ring" class="radar-ring" :points="ring" />
                    <line
                      v-for="axis in radarAxis"
                      :key="`axis-${axis.name}`"
                      class="radar-axis"
                      x1="100"
                      y1="100"
                      :x2="axis.x"
                      :y2="axis.y"
                    />
                    <polygon class="radar-area" :points="radarPolygon" />
                    <circle
                      v-for="point in radarPoints"
                      :key="`point-${point.name}`"
                      class="radar-point"
                      :cx="point.x"
                      :cy="point.y"
                      r="3.2"
                    />
                    <text
                      v-for="axis in radarAxis"
                      :key="`label-${axis.name}`"
                      class="radar-label"
                      :x="axis.labelX"
                      :y="axis.labelY"
                      :text-anchor="axis.anchor"
                    >
                      {{ axis.name }}
                    </text>
                  </svg>
                  <div class="radar-legend">
                    <span v-for="item in radarModules" :key="item.name">
                      <i :style="{ opacity: `${Math.max(.45, item.accuracy / 100)}` }"></i>
                      {{ item.name }} {{ item.accuracy }}%
                    </span>
                  </div>
                </div>
                <AppStateView v-else compact title="雷达图待生成" description="完成至少 3 个模块的练习后，会形成更直观的能力画像。" />
              </div>
              <div class="portrait-metrics">
                <article>
                  <span>累计题数</span>
                  <strong>{{ quality?.totalQuestions || 0 }}</strong>
                </article>
                <article>
                  <span>连续学习</span>
                  <strong>{{ quality?.streak || 0 }}天</strong>
                </article>
                <article>
                  <span>待复习错题</span>
                  <strong>{{ quality?.reviewDueCount || 0 }}</strong>
                </article>
              </div>
            </div>
          </section>

          <p v-if="tutorLoadError" class="refresh-note" role="status">{{ tutorLoadError }}</p>
        </template>
      </div>
    </PullToRefresh>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  BookMarkedIcon,
  CalendarIcon,
  ChevronRightIcon,
  FileTextIcon,
  SparklesIcon,
  TargetIcon
} from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
import { useCachedViewRefresh } from '@/components/layout/useCachedViewRefresh';
import { AppStateView, PullToRefresh, SectionHeading } from '@/capabilities/design-system/public';
import HomeActionGrid from '@/features/home/HomeActionGrid.vue';
import { practiceDetailLocation } from '@/features/practice/PracticeNavigation';
import { useHomeAbilityRadar } from '@/features/home/useHomeAbilityRadar';
import {
  tutorPriorityActionLabel,
  tutorPriorityDetail,
  tutorPriorityLocation,
  tutorPriorityTitle
} from '@/features/home/HomeTutorPriority';
import { initializeTutorRuntime } from '@/composition-root/public';
import {
  InitialDiagnosisStatus,
  type CandidateHomeScore,
  type CandidateHomeSnapshot
} from '@/modules/candidate/public';
import {
  ScoreForecastBasis,
  type ScoreForecastProjection
} from '@/modules/calibration/public';
import type { LearnerPriorityResult } from '@/modules/mastery/public';
import { qualityDashboardService, type QualityDashboard } from '@/services/QualityDashboardService';

// Named so App.vue can hold this tab root in its <KeepAlive> whitelist.
defineOptions({ name: 'HomeView' });

const router = useRouter();
const candidateHome = ref<CandidateHomeSnapshot | null>(null);
const quality = ref<QualityDashboard | null>(null);
const learnerPriorities = ref<readonly LearnerPriorityResult[]>([]);
const {
  modules: radarModules,
  evidenceCount: radarEvidenceCount,
  axis: radarAxis,
  points: radarPoints,
  polygon: radarPolygon,
  gridPolygons: radarGridPolygons
} = useHomeAbilityRadar(quality);
const isTutorLoading = ref(true);
const tutorLoadError = ref('');
onMounted(loadTutorHome);
// Reloading keeps the rendered home on screen: loadTutorHome only raises the
// skeleton while there is no candidate home to show yet.
useCachedViewRefresh(loadTutorHome);
async function loadTutorHome() {
  const showInitialLoading = !candidateHome.value;
  if (showInitialLoading) isTutorLoading.value = true;
  tutorLoadError.value = '';
  try {
    const runtime = await initializeTutorRuntime();
    const nextCandidateHome = await runtime.getCandidateHome.execute() || null;
    candidateHome.value = nextCandidateHome;
    if (nextCandidateHome) {
      isTutorLoading.value = false;
      const [nextQuality, prioritySnapshot] = await Promise.all([
        qualityDashboardService.dashboard({ candidateHome: nextCandidateHome }),
        runtime.buildLearnerPrioritySnapshot.execute()
      ]);
      quality.value = nextQuality;
      learnerPriorities.value = prioritySnapshot?.priorities ?? [];
    } else {
      quality.value = null;
      learnerPriorities.value = [];
    }
  } catch (error) {
    if (showInitialLoading) candidateHome.value = null;
    tutorLoadError.value = error instanceof Error ? error.message : '备考档案加载失败';
  } finally {
    isTutorLoading.value = false;
  }
}

const refreshTutorHome = loadTutorHome;

const phaseLabels: Record<string, string> = {
  foundation: '基础阶段',
  development: '提升阶段',
  consolidation: '巩固阶段',
  sprint: '冲刺阶段',
  maintenance: '保持阶段'
};

const subjectLabels: Record<string, string> = {
  aptitude: '行测',
  essay: '申论',
  interview: '面试'
};

const cycleSubtitle = computed(() => {
  if (!candidateHome.value) return '';
  const days = daysUntil(candidateHome.value.examDate);
  const dayText = days === undefined ? candidateHome.value.examDate : `剩余 ${days} 天`;
  return `${phaseLabels[candidateHome.value.phase] || '备考中'} · ${dayText}`;
});

const scoreRows = computed(() => {
  const forecasts = quality.value?.calibration?.scoreForecasts || [];
  return (candidateHome.value?.scores || []).map((score) => formatScore(
    score,
    forecasts.find((forecast) => forecast.subject === score.subject)
  ));
});

const aptitudeForecast = computed(() => quality.value?.calibration?.scoreForecasts.find(
  (item) => item.subject === 'aptitude' && item.center !== undefined
));

const heroMetric = computed(() => {
  if (aptitudeForecast.value) return { value: String(aptitudeForecast.value.center), label: '行测预测分' };
  if (quality.value?.totalQuestions) return { value: String(quality.value.score), label: '训练质量指数' };
  return { value: '--', label: '待校准' };
});

const hasReliableAbilityProfile = computed(() => (quality.value?.moduleDiagnoses || []).some(
  (item) => item.diagnosisType !== 'insufficient_sample'
));

const recommendedPriority = computed(() => (
  learnerPriorities.value.find((item) => item.reliable)
  ?? learnerPriorities.value[0]
));

const weakModules = computed(() => {
  const seen = new Set<string>();
  const ordered = learnerPriorities.value.flatMap((priority) => {
    if (!priority.reliable || seen.has(priority.module)) return [];
    const module = quality.value?.modules.find((item) => item.code === priority.module);
    if (!module) return [];
    seen.add(priority.module);
    return [module];
  });
  return (ordered.length ? ordered : quality.value?.priorityModules || []).slice(0, 3);
});

const tutorDecisionTitle = computed(() => {
  if (!quality.value?.totalQuestions) return '先建立可信能力基线';
  if ((quality.value.reviewDueCount || 0) > 0) return '先复盘到期错题，再做新题';
  if (!hasReliableAbilityProfile.value) return '继续补齐样本，暂不判断薄弱点';
  if (recommendedPriority.value) return tutorPriorityTitle(recommendedPriority.value);
  return '保持当前节奏，做一次轻量巩固';
});

const tutorDecisionDetail = computed(() => {
  if (!quality.value?.totalQuestions) return '当前样本还少，先完成一组针对性练习，让 AI 私教确认你的真实起点。';
  if ((quality.value.reviewDueCount || 0) > 0) return `${quality.value.reviewDueCount} 道错题已到复习窗口，先闭环旧问题，训练效率更高。`;
  if (!hasReliableAbilityProfile.value) return '已有作答还不足以形成可信模块结论，接下来优先补齐高信息量样本。';
  if (recommendedPriority.value) return tutorPriorityDetail(recommendedPriority.value);
  return '近阶段训练状态稳定，继续用计划保持手感，并做少量迁移训练。';
});

const diagnosisStatusLabel = computed(() => ({
  [InitialDiagnosisStatus.NotStarted]: '尚未开始',
  [InitialDiagnosisStatus.InProgress]: '正在确认',
  [InitialDiagnosisStatus.DataInsufficient]: '数据不足',
  [InitialDiagnosisStatus.Sufficient]: '已建立可信基线'
}[candidateHome.value?.diagnosisStatus || InitialDiagnosisStatus.NotStarted]));

const tutorDecisionEvidence = computed(() => hasReliableAbilityProfile.value && quality.value?.diagnosisSummary
  ? quality.value.diagnosisSummary
  : `${diagnosisStatusLabel.value} · ${diagnosisStatusDetail.value}`);

const diagnosisStatusDetail = computed(() => ({
  [InitialDiagnosisStatus.NotStarted]: '完成少量锚定题，建立能力起点。',
  [InitialDiagnosisStatus.InProgress]: '继续完成高信息量题目，校准能力判断。',
  [InitialDiagnosisStatus.DataInsufficient]: '当前主要来自自报成绩，需要用作答证据确认。',
  [InitialDiagnosisStatus.Sufficient]: '后续训练会持续校准能力判断。'
}[candidateHome.value?.diagnosisStatus || InitialDiagnosisStatus.NotStarted]));

const primaryTutorAction = computed(() => {
  if ((quality.value?.reviewDueCount || 0) > 0) {
    return { name: '复盘到期错题', icon: BookMarkedIcon, to: { path: '/vue/wrongbook', query: { mode: 'review' } } };
  }
  if (!hasReliableAbilityProfile.value) {
    return { name: '建立能力样本', icon: SparklesIcon, to: practiceDetailLocation({ mode: 'tutor' }) };
  }
  if (recommendedPriority.value) {
    const priority = recommendedPriority.value;
    return {
      name: tutorPriorityActionLabel(priority),
      icon: priority.subject === 'essay' ? FileTextIcon : TargetIcon,
      to: tutorPriorityLocation(priority)
    };
  }
  return { name: '开始轻量巩固', icon: SparklesIcon, to: practiceDetailLocation({ mode: 'tutor' }) };
});

function formatScore(score: CandidateHomeScore, forecast?: ScoreForecastProjection) {
  const label = subjectLabels[score.subject] || score.subject;
  const currentScore = forecast?.center ?? score.currentScore;
  const current = currentScore === undefined ? '待诊断' : `${currentScore}`;
  const gap = currentScore === undefined ? undefined : roundScore(score.targetScore - currentScore);
  const gapText = gap === undefined ? '待确认差距' : gap <= 0 ? '已达目标' : `差 ${gap} 分`;
  const tone = gap === undefined ? 'unknown' : gap <= 0 ? 'good' : gap >= 15 ? 'danger' : 'warning';
  return {
    subject: score.subject,
    label,
    current,
    currentMeta: forecastBasisLabel(forecast?.basis, score.evidenceLabel),
    target: score.targetScore,
    gapText,
    tone
  };
}

function forecastBasisLabel(
  basis: ScoreForecastProjection['basis'] | undefined,
  evidenceLabel: CandidateHomeScore['evidenceLabel']
): string {
  if (basis === ScoreForecastBasis.TrueQuestionCalibrated) return '真题校准';
  if (basis === ScoreForecastBasis.Blended) return '综合预测';
  if (basis === ScoreForecastBasis.TrainingEvidence) return '训练预测';
  if (basis === ScoreForecastBasis.Measured || evidenceLabel === 'measured') return '最近测评';
  if (basis === ScoreForecastBasis.SelfReport || evidenceLabel === 'self_report') return '自报基线';
  return '能力待诊断';
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

function daysUntil(value: string): number | undefined {
  const target = new Date(`${value}T00:00:00`);
  if (Number.isNaN(target.getTime())) return undefined;
  return Math.max(0, Math.ceil((target.getTime() - Date.now()) / 86400000));
}

function startWeakPractice(module: string) {
  const priority = learnerPriorities.value.find((item) => item.module === module);
  void router.push(priority
    ? tutorPriorityLocation(priority)
    : practiceDetailLocation({ mode: 'tutor', module }));
}

</script>

<style scoped>
.home-page {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.home-scroll {
  padding-top: 14px;
}

.home-content,
.section-group {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.onboarding-card,
.tutor-hero,
.portrait-section,
.baseline-card {
  border-radius: var(--radius-card);
  padding: 16px;
  background: var(--surface-card);
  box-shadow: var(--app-shadow-soft);
}

.onboarding-card {
  display: flex;
  align-items: center;
  gap: 12px;
}

.onboarding-card div {
  flex: 1;
  min-width: 0;
}

.onboarding-card span,
.hero-copy span {
  display: block;
  color: var(--primary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.onboarding-card strong,
.hero-copy strong {
  display: block;
  margin-top: 4px;
  font-size: var(--type-size-control);
  line-height: 1.35;
}

.onboarding-card p,
.hero-copy p,
.baseline-card p {
  margin: 6px 0 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  line-height: 1.5;
}

.onboarding-card button,
.hero-actions button,
.section-heading button {
  border: 0;
  font: inherit;
}

.onboarding-card button {
  min-height: 38px;
  border-radius: 999px;
  padding: 0 14px;
  flex-shrink: 0;
  color: #fff;
  background: var(--primary-color);
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}

.tutor-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 94px;
  gap: 12px;
  background: var(--surface-feature-tutor);
}

.hero-evidence { grid-column:1/-1; color:var(--text-secondary-color); font-size:var(--type-size-micro); line-height:1.45; }

.hero-copy {
  min-width: 0;
}

.hero-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}

.hero-meter { min-width:0; min-height:78px; border:0; border-radius:16px; padding:9px 6px; display:grid; place-items:center; align-content:center; overflow:hidden; background:rgba(var(--color-brand-rgb),.045); font:inherit; transition:transform var(--motion-fast) ease, background var(--motion-fast) ease; }

.hero-meter:active { transform:scale(.96); background:rgba(var(--color-brand-rgb),.09); }

.hero-meter strong { max-width:100%; color:var(--primary-color); font-size:var(--type-size-metric); line-height:1; font-variant-numeric:tabular-nums; white-space:nowrap; }

.hero-meter span { max-width:100%; margin-top:3px; overflow:hidden; color:var(--text-secondary-color); font-size:var(--type-size-micro); font-weight:var(--type-weight-semibold); text-overflow:ellipsis; white-space:nowrap; }

.hero-actions {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
}

.hero-actions button {
  min-height: 42px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .1);
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}

.hero-actions .primary-action {
  color: #fff;
  background: var(--primary-color);
}

.hero-actions svg {
  width: 16px;
  height: 16px;
}

.baseline-card { display:flex; align-items:center; gap:12px; background:var(--surface-feature-highlight-soft); }

.baseline-card div { min-width: 0; flex: 1; }
.baseline-card span { color: var(--primary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); }
.baseline-card strong { display: block; margin-top: 4px; font-size: var(--type-size-body-large); }
.baseline-card button { min-height: 38px; flex: 0 0 auto; border: 0; border-radius: var(--radius-pill); padding: 0 13px; color: var(--primary-color); background: rgba(var(--color-brand-rgb), .1); font: inherit; font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); }

.section-heading button {
  color: var(--text-secondary-color);
  background: transparent;
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.score-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.score-card,
.portrait-metrics article {
  min-width: 0;
  border-radius: 14px;
  padding: 12px;
  background: rgba(var(--color-brand-rgb), .065);
}

.score-card span,
.portrait-metrics span {
  display: block;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.score-card strong {
  display: block;
  margin-top: 5px;
  font-size: var(--type-size-page-title);
  line-height: 1;
}

.score-card em {
  display: block;
  margin-top: 5px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-style: normal;
}

.score-card b {
  display: inline-flex;
  margin-top: 7px;
  border-radius: 999px;
  padding: 3px 8px;
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.score-card b.good { color: var(--green-color); background: rgba(52,199,89,.12); }
.score-card b.warning { color: var(--orange-color); background: rgba(255,149,0,.12); }
.score-card b.danger { color: var(--red-color); background: rgba(255,59,48,.11); }
.score-card b.unknown { color: var(--text-secondary-color); background: rgba(var(--color-ink-rgb), .07); }

.ability-chart-card {
  margin-top: 12px;
  padding: 8px 0 2px;
  background: transparent;
  box-shadow: none;
}

.chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.chart-head strong {
  font-size: var(--type-size-body);
}

.chart-head span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.radar-panel {
  display: grid;
  grid-template-columns: minmax(0, 180px) minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  margin-top: 6px;
}

.ability-radar {
  width: 100%;
  max-width: 180px;
  aspect-ratio: 1;
  display: block;
}

.radar-ring {
  fill: none;
  stroke: rgba(var(--color-ink-rgb), .075);
  stroke-width: 1;
}

.radar-axis {
  stroke: rgba(var(--color-ink-rgb), .055);
  stroke-width: 1;
}

.radar-area {
  fill: rgba(var(--color-brand-rgb), .18);
  stroke: rgba(var(--color-brand-rgb), .76);
  stroke-width: 2;
  stroke-linejoin: round;
}

.radar-point {
  fill: var(--primary-color);
  stroke: rgba(255,255,255,.9);
  stroke-width: 1.5;
}

.radar-label {
  fill: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.radar-legend {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.radar-legend span {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.radar-legend i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--primary-color);
}

.portrait-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.portrait-metrics article {
  text-align: center;
}

.portrait-metrics strong {
  display: block;
  margin-top: 5px;
  font-size: var(--type-size-body-large);
}

.weak-list {
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--surface-card);
  box-shadow: var(--app-shadow-soft);
}

.weak-row {
  width: 100%;
  min-height: 66px;
  border: 0;
  border-top: 1px solid rgba(var(--color-ink-rgb), .055);
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
}

.weak-row:first-child {
  border-top: 0;
}

.weak-row i {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: var(--orange-color);
  background: rgba(255,149,0,.12);
  font-size: var(--type-size-caption);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}

.weak-row span {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.weak-row strong,
.weak-row em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.weak-row strong {
  font-size: var(--type-size-body);
}

.weak-row em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-style: normal;
}

.weak-row > svg {
  width: 16px;
  height: 16px;
  color: var(--text-secondary-color);
}

.refresh-note { margin: 0; color: var(--text-secondary-color); font-size: var(--type-size-micro); text-align: center; }

.loading-skeleton {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.skeleton-card {
  height: 120px;
  border-radius: var(--radius-card);
  background: linear-gradient(90deg, var(--surface-card), var(--surface-card-strong), var(--surface-card));
  background-size: 220% 100%;
  animation: pulse 1.3s ease-in-out infinite;
}

.skeleton-card.hero {
  height: 178px;
}

@media (max-width: 360px) {
  .radar-panel {
    grid-template-columns: 1fr;
  }

  .ability-radar {
    margin: 0 auto;
    max-width: 172px;
  }

  .radar-legend {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@keyframes pulse {
  0% { background-position: 0 0; }
  100% { background-position: -220% 0; }
}
</style>
