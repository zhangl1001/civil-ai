<template>
  <div class="learning-center-page app-page">
    <PageHeader title="学习中心" meta="知识学习、积累、复习和阶段校准" />

    <PullToRefresh class="learning-center-scroll" :on-refresh="loadDashboard">
      <section class="learning-hero">
        <div>
          <span>AI 私教学习台</span>
          <strong>{{ learningDecision.title }}</strong>
          <p>{{ learningDecision.detail }}</p>
        </div>
        <BookOpenCheckIcon />
      </section>

      <section class="learning-overview">
        <article>
          <span>知识模块</span>
          <strong>{{ studyDashboard?.modules.length || 0 }}</strong>
          <em>大纲学习路径</em>
        </article>
        <article>
          <span>薄弱考点</span>
          <strong>{{ studyDashboard?.weakPoints.length || 0 }}</strong>
          <em>优先讲解训练</em>
        </article>
        <article>
          <span>今日积累</span>
          <strong>{{ digestDone ? '已完成' : '待完成' }}</strong>
          <em>{{ digestCount }} 个条目</em>
        </article>
      </section>

      <section class="section-group">
        <div class="section-title">
          <strong>学习路径建议</strong>
          <span>{{ isLoading ? '同步中' : '今日' }}</span>
        </div>
        <div class="path-card">
          <div class="path-steps">
            <button v-for="step in learningSteps" :key="step.title" type="button" @click="router.push(step.to)">
              <i :class="step.tone"><component :is="step.icon" /></i>
              <span>
                <strong>{{ step.title }}</strong>
                <em>{{ step.detail }}</em>
              </span>
            </button>
          </div>
        </div>
      </section>

      <section class="section-group">
        <div class="section-title">
          <strong>最近需要学透的考点</strong>
          <button type="button" @click="router.push('/vue/study/lecture')">去精讲</button>
        </div>
        <div v-if="weakPoints.length" class="weak-point-list">
          <button v-for="point in weakPoints" :key="`${point.module}-${point.name}`" type="button" @click="learn(point)">
            <span>
              <strong>{{ point.name }}</strong>
              <em>{{ point.module }} · {{ point.reason }}</em>
            </span>
            <b>{{ point.proficiency }}%</b>
          </button>
        </div>
        <AppStateView v-else compact title="暂无明确薄弱考点" description="完成练习后，这里会自动出现需要先学透的知识点。" />
      </section>

      <section class="section-group">
        <div class="section-title">
          <strong>学习功能</strong>
          <span>先学后练</span>
        </div>
        <div class="feature-grid">
          <button v-for="item in primaryItems" :key="item.title" type="button" class="feature-card" @click="router.push(item.to)">
            <i :class="item.tone"><component :is="item.icon" /></i>
            <strong>{{ item.title }}</strong>
            <span>{{ item.description }}</span>
          </button>
        </div>
      </section>

      <section class="section-group">
        <div class="section-title">
          <strong>训练与复盘</strong>
          <span>巩固闭环</span>
        </div>
        <div class="feature-list">
          <button v-for="item in trainingItems" :key="item.title" type="button" class="feature-row" @click="router.push(item.to)">
            <i :class="item.tone"><component :is="item.icon" /></i>
            <span>
              <strong>{{ item.title }}</strong>
              <em>{{ item.description }}</em>
            </span>
            <ChevronRightIcon />
          </button>
        </div>
      </section>

      <section class="section-group">
        <div class="section-title">
          <strong>阶段校准</strong>
          <span>不放底部导航</span>
        </div>
        <div class="feature-list">
          <button v-for="item in assessmentItems" :key="item.title" type="button" class="feature-row" @click="router.push(item.to)">
            <i :class="item.tone"><component :is="item.icon" /></i>
            <span>
              <strong>{{ item.title }}</strong>
              <em>{{ item.description }}</em>
            </span>
            <ChevronRightIcon />
          </button>
        </div>
      </section>
    </PullToRefresh>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  BookMarkedIcon,
  BookOpenCheckIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  FileTextIcon,
  LandmarkIcon,
  MapIcon,
  MicIcon,
  MonitorIcon,
  PenLineIcon,
  RotateCcwIcon,
  SparklesIcon,
  TargetIcon
} from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
import { AppStateView, PullToRefresh } from '@/capabilities/design-system/public';
import { digestService } from '@/services/DigestService';
import { examFlowService } from '@/services/ExamFlowService';
import { studyService, type StudyDashboard, type StudyPoint } from '@/services/StudyService';

const router = useRouter();
const studyDashboard = ref<StudyDashboard | null>(null);
const digestCount = ref(0);
const mockCount = ref(0);
const mockBest = ref(0);
const isLoading = ref(false);

onMounted(loadDashboard);

const weakPoints = computed(() => (studyDashboard.value?.weakPoints || []).slice(0, 4));
const digestDone = computed(() => digestCount.value > 0);

const learningDecision = computed(() => {
  const first = weakPoints.value[0];
  if (first) {
    return {
      title: `今天先学透「${first.name}」`,
      detail: `${first.module} 当前需要优先补强。建议先看精讲，再做一组针对性练习，最后回到错题本复盘。`
    };
  }
  if (!digestDone.value) {
    return {
      title: '先完成今日积累，保持输入',
      detail: '今天还没有时政或知识点积累。先做轻量输入，再进入专项训练。'
    };
  }
  return {
    title: '学习节奏稳定，做一次阶段校准',
    detail: mockCount.value ? `已有 ${mockCount.value} 次模考记录，最好正确率 ${mockBest.value || 0}%。可以按计划继续精讲和训练。` : '完成一轮学习和刷题后，可以用一次模考校准真实水平。'
  };
});

const learningSteps = computed(() => {
  const first = weakPoints.value[0];
  return [
    {
      title: first ? `精讲：${first.name}` : '考点精讲',
      detail: first ? `${first.module} · ${first.reason}` : '先从大纲知识点建立方法框架',
      icon: BookOpenIcon,
      tone: 'green',
      to: '/vue/study/lecture'
    },
    {
      title: digestDone.value ? '回看今日积累' : '生成每日积累',
      detail: digestDone.value ? `今日已有 ${digestCount.value} 个条目` : '补充时政热点和知识点输入',
      icon: LandmarkIcon,
      tone: 'blue',
      to: '/vue/digest'
    },
    {
      title: '针对性练习',
      detail: first ? `围绕 ${first.name} 练一组` : '用练习建立能力样本',
      icon: TargetIcon,
      tone: 'orange',
    to: '/vue/practice/session'
    },
    {
      title: mockCount.value ? '查看模考表现' : '安排一次模考',
      detail: mockCount.value ? `最好正确率 ${mockBest.value || 0}%` : '阶段校准真实水平',
      icon: MonitorIcon,
      tone: 'purple',
      to: '/vue/exam'
    }
  ];
});

async function loadDashboard() {
  isLoading.value = true;
  try {
    const [study, digest, exam] = await Promise.all([
      studyService.dashboard(),
      digestService.dashboard('news'),
      examFlowService.dashboard('行测')
    ]);
    studyDashboard.value = study;
    digestCount.value = digest.sections.length;
    mockCount.value = exam.stats.total;
    mockBest.value = exam.stats.bestAccuracy;
  } finally {
    isLoading.value = false;
  }
}

async function learn(point: StudyPoint) {
  await studyService.startLearning(point);
  await router.push('/vue/study/lecture');
}

const primaryItems = [
  { title: '考点精讲', description: '按知识点学习讲义和方法', icon: BookOpenIcon, tone: 'green', to: '/vue/study/lecture' },
  { title: '每日积累', description: '时政热点和知识点沉淀', icon: LandmarkIcon, tone: 'blue', to: '/vue/digest' },
  { title: '行测刷题', description: '专项、自定义和薄弱点训练', icon: PenLineIcon, tone: 'orange', to: '/vue/practice/session' },
  { title: '申论练习', description: '讲义、材料题和作答批改', icon: FileTextIcon, tone: 'green', to: '/vue/essay' },
  { title: '知识地图', description: '按大纲查看掌握情况', icon: MapIcon, tone: 'purple', to: '/vue/knowledge-graph' }
];

const trainingItems = [
  { title: '薄弱点训练', description: '根据能力画像训练行测短板', icon: SparklesIcon, tone: 'blue', to: '/vue/practice/session' },
  { title: '错题复盘', description: '查看错因、闪卡和重做入口', icon: BookMarkedIcon, tone: 'red', to: '/vue/wrongbook' },
  { title: '学习日历', description: '回看练习记录和复习节奏', icon: CalendarDaysIcon, tone: 'gray', to: '/vue/calendar' },
  { title: '错因报告', description: '按错因聚合复盘策略', icon: RotateCcwIcon, tone: 'orange', to: '/vue/error-report' }
];

const assessmentItems = [
  { title: '模拟考试', description: '阶段校准，不占用一级导航', icon: MonitorIcon, tone: 'blue', to: '/vue/exam' },
  { title: '面试模拟', description: '结构化表达训练和 AI 复盘', icon: MicIcon, tone: 'purple', to: '/vue/interview' }
];
</script>

<style scoped>
.learning-center-page {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.learning-center-scroll {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 14px;
}

.learning-hero {
  min-height: 126px;
  border-radius: 18px;
  padding: 18px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 40px;
  gap: 10px;
  align-items: center;
  background: linear-gradient(135deg, rgba(255,255,255,.88), rgba(232,246,241,.76));
  box-shadow: var(--app-shadow-soft);
}

.learning-hero > div {
  min-width: 0;
}

.learning-hero span {
  color: var(--primary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.learning-hero strong {
  display: block;
  margin-top: 5px;
  font-size: var(--type-size-section-title);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.learning-hero p {
  margin: 7px 0 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  line-height: 1.5;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.learning-hero > svg {
  width: 36px;
  height: 36px;
  color: var(--primary-color);
}

.learning-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.learning-overview article {
  min-width: 0;
  border-radius: 14px;
  padding: 11px 9px;
  background: rgba(var(--color-surface-rgb), .68);
  box-shadow: var(--app-shadow-soft);
  text-align: center;
}

.learning-overview span,
.learning-overview em {
  display: block;
  overflow: hidden;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.learning-overview strong {
  display: block;
  margin: 6px 0 4px;
  font-size: var(--type-size-body-large);
}

.section-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title strong {
  font-size: var(--type-size-body-large);
}

.section-title span,
.section-title button {
  border: 0;
  background: transparent;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.path-card,
.weak-point-list {
  overflow: hidden;
  border-radius: 14px;
  background: rgba(var(--color-surface-rgb), .58);
  box-shadow: var(--app-shadow-soft);
}

.path-steps {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  background: rgba(var(--color-ink-rgb), .045);
}

.path-steps button {
  min-height: 82px;
  border: 0;
  padding: 12px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: inherit;
  background: rgba(255,255,255,.66);
  font: inherit;
  text-align: left;
}

.path-steps i {
  width: 32px;
  height: 32px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.path-steps svg {
  width: 17px;
  height: 17px;
}

.path-steps span,
.weak-point-list span {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.path-steps strong,
.path-steps em,
.weak-point-list strong,
.weak-point-list em {
  overflow: hidden;
  text-overflow: ellipsis;
}

.path-steps strong,
.weak-point-list strong {
  color: var(--text-color);
  font-size: var(--type-size-secondary);
  white-space: nowrap;
}

.path-steps em,
.weak-point-list em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-style: normal;
  line-height: 1.4;
}

.weak-point-list button {
  width: 100%;
  min-height: 58px;
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

.weak-point-list button:first-child {
  border-top: 0;
}

.weak-point-list b {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 4px 8px;
  color: var(--orange-color);
  background: rgba(255,149,0,.12);
  font-size: var(--type-size-micro);
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.feature-card,
.feature-row {
  border: 0;
  color: inherit;
  background: rgba(var(--color-surface-rgb), .62);
  box-shadow: var(--app-shadow-soft);
  font: inherit;
  text-align: left;
}

.feature-card {
  min-height: 118px;
  border-radius: 14px;
  padding: 13px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.feature-card i,
.feature-row i {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.feature-card svg,
.feature-row svg {
  width: 18px;
  height: 18px;
}

.feature-card strong,
.feature-row strong {
  color: var(--text-color);
  font-size: var(--type-size-body);
}

.feature-card span,
.feature-row em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  line-height: 1.45;
  font-style: normal;
}

.feature-list {
  overflow: hidden;
  border-radius: 14px;
  background: rgba(var(--color-surface-rgb), .56);
  box-shadow: var(--app-shadow-soft);
}

.feature-row {
  width: 100%;
  min-height: 68px;
  border-radius: 0;
  padding: 11px 12px;
  display: flex;
  align-items: center;
  gap: 11px;
  box-shadow: none;
  background: transparent;
  border-top: 1px solid rgba(var(--color-ink-rgb), .055);
}

.feature-row:first-child {
  border-top: 0;
}

.feature-row span {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.feature-row > svg {
  width: 16px;
  height: 16px;
  color: var(--text-secondary-color);
}

.green { color: var(--green-color); background: rgba(52,199,89,.12); }
.blue { color: var(--primary-color); background: rgba(var(--color-brand-rgb), .12); }
.orange { color: var(--orange-color); background: rgba(255,149,0,.12); }
.purple { color: #7e57c2; background: rgba(126,87,194,.12); }
.red { color: var(--red-color); background: rgba(255,59,48,.11); }
.gray { color: var(--text-secondary-color); background: rgba(var(--color-ink-rgb), .07); }

@media (max-width: 360px) {
  .path-steps {
    grid-template-columns: 1fr;
  }
}

</style>
