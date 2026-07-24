<template>
  <div class="home-page app-page">
    <PageHeader :level="1">
      <template #title>
        <div class="app-title-row">
          <span class="app-title-icon"><GraduationCapIcon /></span>
          <div class="app-title-copy">
            <h3>{{ candidateHome?.projectName || 'AI 私教备考' }}</h3>
            <span>{{ candidateHome ? cycleSubtitle : '建立档案后开始个性化训练' }}</span>
          </div>
        </div>
      </template>
      <template #actions>
        <button class="icon-button" type="button" @click="router.push('/vue/calendar')"><CalendarIcon /></button>
      </template>
    </PageHeader>

    <PullToRefresh class="home-scroll" :on-refresh="loadTutorHome">
      <div v-if="isTutorLoading" class="loading-skeleton">
        <div class="skeleton-card hero"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
      </div>

      <div v-else class="home-content">
        <AppStateView
          v-if="tutorLoadError"
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
              <span>今日私教判断</span>
              <strong>{{ tutorDecisionTitle }}</strong>
              <p>{{ tutorDecisionDetail }}</p>
            </div>
            <div class="hero-meter">
              <strong>{{ quality?.score ?? '--' }}</strong>
              <span>{{ quality?.grade || '待诊断' }}</span>
            </div>
            <div class="hero-actions">
              <button class="primary-action" type="button" @click="router.push('/vue/plan')">
                <SparklesIcon />
                今日计划
              </button>
              <button type="button" @click="router.push('/vue/practice')">
                <TargetIcon />
                针对性练习
              </button>
            </div>
          </section>

          <section class="portrait-section">
            <div class="section-title">
              <strong>个人能力画像</strong>
              <button type="button" @click="router.push('/vue/quality-dashboard')">完整报告</button>
            </div>
            <div class="score-grid">
              <article v-for="score in scoreRows" :key="score.subject" class="score-card">
                <span>{{ score.label }}</span>
                <strong>{{ score.current }}</strong>
                <em>目标 {{ score.target }}</em>
                <b :class="score.tone">{{ score.gapText }}</b>
              </article>
            </div>
            <div class="ability-chart-card">
              <div class="chart-head">
                <strong>能力雷达</strong>
                <span>{{ radarModules.length ? '模块正确率' : '等待练习样本' }}</span>
              </div>
              <div v-if="radarModules.length >= 3" class="radar-panel">
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
                    {{ axis.shortName }}
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
          </section>

          <section class="section-group">
            <div class="section-title">
              <strong>薄弱点与训练优先级</strong>
              <button type="button" @click="router.push('/vue/knowledge-graph')">知识地图</button>
            </div>
            <div v-if="weakModules.length" class="weak-list">
              <button v-for="(item, index) in weakModules" :key="item.name" type="button" class="weak-row" @click="startWeakPractice(item.name)">
                <i>{{ index + 1 }}</i>
                <span>
                  <strong>{{ item.name }}</strong>
                  <em>{{ item.total }} 题样本 · 正确率 {{ item.accuracy }}%</em>
                </span>
                <ChevronRightIcon />
              </button>
            </div>
            <AppStateView v-else compact title="能力样本不足" description="先完成一组针对性练习，首页会生成薄弱点画像。" />
          </section>

          <section class="coach-card">
            <div class="section-title">
              <strong>私教解释</strong>
              <span>{{ diagnosisStatusLabel }}</span>
            </div>
            <p>{{ quality?.diagnosisSummary || diagnosisStatusDetail }}</p>
            <ul>
              <li v-for="item in coachAdvice" :key="item">{{ item }}</li>
            </ul>
          </section>

          <section class="section-group">
            <div class="section-title">
              <strong>今日行动</strong>
              <span>指导 · 学习 · 训练</span>
            </div>
            <div class="action-grid">
              <button v-for="action in actionCards" :key="action.name" type="button" class="action-card" @click="router.push(action.to)">
                <i :class="action.color"><component :is="action.icon" /></i>
                <strong>{{ action.name }}</strong>
                <span>{{ action.sub }}</span>
              </button>
            </div>
          </section>
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
  BookOpenIcon,
  CalendarIcon,
  ChevronRightIcon,
  Edit3Icon,
  FileTextIcon,
  GraduationCapIcon,
  MonitorIcon,
  SparklesIcon,
  TargetIcon
} from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
import { AppStateView, PullToRefresh } from '@/capabilities/design-system/public';
import { initializeTutorRuntime } from '@/composition-root/public';
import {
  InitialDiagnosisStatus,
  type CandidateHomeScore,
  type CandidateHomeSnapshot
} from '@/modules/candidate/public';
import { qualityDashboardService, type QualityDashboard } from '@/services/QualityDashboardService';
import { practiceFlowService } from '@/services/PracticeFlowService';

const router = useRouter();
const candidateHome = ref<CandidateHomeSnapshot | null>(null);
const quality = ref<QualityDashboard | null>(null);
const isTutorLoading = ref(true);
const tutorLoadError = ref('');

onMounted(loadTutorHome);

async function loadTutorHome() {
  isTutorLoading.value = true;
  tutorLoadError.value = '';
  quality.value = null;
  try {
    const runtime = await initializeTutorRuntime();
    candidateHome.value = await runtime.getCandidateHome.execute() || null;
    if (candidateHome.value) {
      quality.value = await qualityDashboardService.dashboard();
    }
  } catch (error) {
    candidateHome.value = null;
    tutorLoadError.value = error instanceof Error ? error.message : '备考档案加载失败';
  } finally {
    isTutorLoading.value = false;
  }
}

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

const scoreRows = computed(() => (candidateHome.value?.scores || []).map(formatScore));

const weakModules = computed(() => {
  return (quality.value?.modules || [])
    .filter((item) => item.total > 0)
    .slice()
    .sort((left, right) => left.accuracy - right.accuracy || right.total - left.total)
    .slice(0, 3);
});

const radarModules = computed(() => {
  return (quality.value?.modules || [])
    .filter((item) => item.total > 0)
    .slice()
    .sort((left, right) => right.total - left.total)
    .slice(0, 5);
});

const radarAxis = computed(() => {
  const total = radarModules.value.length;
  return radarModules.value.map((module, index) => {
    const point = radarPoint(index, total, 1);
    const label = radarPoint(index, total, 1.18);
    return {
      name: module.name,
      shortName: module.name.length > 4 ? `${module.name.slice(0, 4)}` : module.name,
      x: point.x,
      y: point.y,
      labelX: label.x,
      labelY: label.y,
      anchor: label.x > 112 ? 'start' : label.x < 88 ? 'end' : 'middle'
    };
  });
});

const radarPoints = computed(() => {
  const total = radarModules.value.length;
  return radarModules.value.map((module, index) => ({
    name: module.name,
    ...radarPoint(index, total, Math.max(8, module.accuracy) / 100)
  }));
});

const radarPolygon = computed(() => radarPoints.value.map((point) => `${point.x},${point.y}`).join(' '));
const radarGridPolygons = computed(() => [0.25, 0.5, 0.75, 1].map((scale) => (
  radarModules.value.map((_, index) => {
    const point = radarPoint(index, radarModules.value.length, scale);
    return `${point.x},${point.y}`;
  }).join(' ')
)));

const tutorDecisionTitle = computed(() => {
  if (!quality.value?.totalQuestions) return '先建立可信能力基线';
  if ((quality.value.reviewDueCount || 0) > 0) return '先复盘到期错题，再做新题';
  if (quality.value.weakestModule) return `今天优先突破 ${quality.value.weakestModule.name}`;
  return '保持当前节奏，做一次轻量巩固';
});

const tutorDecisionDetail = computed(() => {
  if (!quality.value?.totalQuestions) return '当前样本还少，先完成一组针对性练习，让 AI 私教确认你的真实起点。';
  if ((quality.value.reviewDueCount || 0) > 0) return `${quality.value.reviewDueCount} 道错题已到复习窗口，先闭环旧问题，训练效率更高。`;
  if (quality.value.weakestModule) return `${quality.value.weakestModule.name} 当前正确率 ${quality.value.weakestModule.accuracy}%，适合先讲解再配一组专项训练。`;
  return '近阶段训练状态稳定，继续用计划保持手感，并做少量迁移训练。';
});

const coachAdvice = computed(() => {
  const advice = quality.value?.advice || [];
  return advice.length ? advice.slice(0, 3) : [diagnosisStatusDetail.value];
});

const diagnosisStatusLabel = computed(() => ({
  [InitialDiagnosisStatus.NotStarted]: '尚未开始',
  [InitialDiagnosisStatus.InProgress]: '正在确认',
  [InitialDiagnosisStatus.DataInsufficient]: '数据不足',
  [InitialDiagnosisStatus.Sufficient]: '已建立可信基线'
}[candidateHome.value?.diagnosisStatus || InitialDiagnosisStatus.NotStarted]));

const diagnosisStatusDetail = computed(() => ({
  [InitialDiagnosisStatus.NotStarted]: '完成少量锚定题，建立能力起点。',
  [InitialDiagnosisStatus.InProgress]: '继续完成高信息量题目，校准能力判断。',
  [InitialDiagnosisStatus.DataInsufficient]: '当前主要来自自报成绩，需要用作答证据确认。',
  [InitialDiagnosisStatus.Sufficient]: '后续训练会持续校准能力判断。'
}[candidateHome.value?.diagnosisStatus || InitialDiagnosisStatus.NotStarted]));

const actionCards = [
  { name: '学习中心', sub: '讲义、积累和路径', icon: BookOpenIcon, color: 'study', to: '/vue/study' },
  { name: '针对性练习', sub: '围绕薄弱点刷题', icon: Edit3Icon, color: 'practice', to: '/vue/practice/session' },
  { name: '错题复盘', sub: '错因、闪卡、重做', icon: BookMarkedIcon, color: 'wrong', to: '/vue/wrongbook' },
  { name: '申论练习', sub: '材料题和批改', icon: FileTextIcon, color: 'essay', to: '/vue/essay' },
  { name: '阶段模考', sub: '校准真实水平', icon: MonitorIcon, color: 'mock', to: '/vue/exam' },
  { name: '完整画像', sub: '质量追踪报告', icon: TargetIcon, color: 'report', to: '/vue/quality-dashboard' }
];

function formatScore(score: CandidateHomeScore) {
  const label = subjectLabels[score.subject] || score.subject;
  const current = score.currentScore === undefined ? '待诊断' : `${score.currentScore}`;
  const gap = score.gap;
  const gapText = gap === undefined ? '待确认差距' : gap <= 0 ? '已达目标' : `差 ${gap} 分`;
  const tone = gap === undefined ? 'unknown' : gap <= 0 ? 'good' : gap >= 15 ? 'danger' : 'warning';
  return { subject: score.subject, label, current, target: score.targetScore, gapText, tone };
}

function daysUntil(value: string): number | undefined {
  const target = new Date(`${value}T00:00:00`);
  if (Number.isNaN(target.getTime())) return undefined;
  return Math.max(0, Math.ceil((target.getTime() - Date.now()) / 86400000));
}

function startWeakPractice(module: string) {
  practiceFlowService.writeStartContext({ module, mode: 'practice' });
  qualityDashboardService.startWeakPractice(module);
  void router.push('/vue/practice/session');
}

function radarPoint(index: number, total: number, scale: number): { x: number; y: number } {
  if (total <= 0) return { x: 100, y: 100 };
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / total;
  const radius = 66 * scale;
  return {
    x: roundChart(100 + Math.cos(angle) * radius),
    y: roundChart(100 + Math.sin(angle) * radius)
  };
}

function roundChart(value: number): number {
  return Math.round(value * 10) / 10;
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

.app-title-row {
  display: flex;
  align-items: center;
  gap: 9px;
}

.app-title-icon {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .1);
}

.app-title-icon svg {
  width: 19px;
  height: 19px;
}

.app-title-copy {
  min-width: 0;
}

.app-title-copy h3 {
  margin: 0;
  font-size: var(--type-size-section-title);
}

.app-title-copy span {
  display: block;
  margin-top: 2px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.onboarding-card,
.tutor-hero,
.portrait-section,
.coach-card {
  border-radius: 18px;
  padding: 16px;
  background: rgba(var(--color-surface-rgb), .76);
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
.coach-card p {
  margin: 6px 0 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  line-height: 1.5;
}

.onboarding-card button,
.hero-actions button,
.section-title button {
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
  grid-template-columns: minmax(0, 1fr) 76px;
  gap: 14px;
  background:
    linear-gradient(135deg, rgba(255,255,255,.9), rgba(232,246,241,.78));
}

.hero-copy {
  min-width: 0;
}

.hero-meter {
  height: 76px;
  border-radius: 18px;
  display: grid;
  place-items: center;
  align-content: center;
  background: rgba(255,255,255,.72);
  box-shadow: inset 0 0 0 1px rgba(var(--color-brand-rgb), .08);
}

.hero-meter strong {
  color: var(--primary-color);
  font-size: var(--type-size-metric);
  line-height: 1;
}

.hero-meter span {
  margin-top: 3px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

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

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.section-title strong {
  font-size: var(--type-size-body-large);
}

.section-title span,
.section-title button {
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
  border-radius: 16px;
  padding: 13px;
  background:
    linear-gradient(180deg, rgba(255,255,255,.72), rgba(255,255,255,.48));
  box-shadow: inset 0 0 0 1px rgba(var(--color-ink-rgb), .045);
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
  border-radius: 16px;
  background: rgba(var(--color-surface-rgb), .62);
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

.coach-card ul {
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  list-style: none;
}

.coach-card li {
  position: relative;
  padding-left: 15px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  line-height: 1.5;
}

.coach-card li::before {
  content: "";
  position: absolute;
  left: 0;
  top: .65em;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary-color);
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.action-card {
  min-height: 104px;
  border: 0;
  border-radius: 16px;
  padding: 13px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  color: inherit;
  background: rgba(var(--color-surface-rgb), .72);
  box-shadow: var(--app-shadow-soft);
  font: inherit;
  text-align: left;
}

.action-card i {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: grid;
  place-items: center;
}

.action-card svg {
  width: 18px;
  height: 18px;
}

.action-card strong {
  font-size: var(--type-size-body);
}

.action-card span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
}

.action-card .study { color: var(--green-color); background: rgba(52,199,89,.12); }
.action-card .practice,
.action-card .report { color: var(--primary-color); background: rgba(var(--color-brand-rgb), .12); }
.action-card .wrong { color: var(--red-color); background: rgba(255,59,48,.11); }
.action-card .essay { color: var(--orange-color); background: rgba(255,149,0,.12); }
.action-card .mock { color: #1e8e3e; background: rgba(30,142,62,.12); }

.loading-skeleton {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.skeleton-card {
  height: 120px;
  border-radius: 18px;
  background: linear-gradient(90deg, rgba(255,255,255,.48), rgba(255,255,255,.86), rgba(255,255,255,.48));
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
