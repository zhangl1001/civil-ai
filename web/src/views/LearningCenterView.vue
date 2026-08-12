<template>
  <div class="learning-center app-page">
    <PageHeader title="学习中心" meta="知识学习、每日积累与学后巩固" />

    <PullToRefresh class="learning-scroll" :on-refresh="loadDashboard">
      <AppStateView v-if="!studyDashboard && isLoading" state="loading" compact title="正在更新学习建议" />
      <AppStateView
        v-else-if="!studyDashboard && loadError"
        state="error"
        compact
        title="学习建议暂时无法读取"
        :description="loadError"
      >
        <template #actions><button class="retry-button" type="button" @click="loadDashboard">重新加载</button></template>
      </AppStateView>
      <template v-else-if="studyDashboard">
      <section class="learning-hero">
        <div>
          <span>今日学习建议</span>
          <strong>{{ learningDecision.title }}</strong>
          <p>{{ learningDecision.detail }}</p>
          <button
            v-if="!studyDashboard.hasLearningEvidence"
            type="button"
            class="baseline-action"
            @click="router.push('/vue/practice?mode=tutor')"
          >
            开始能力诊断
          </button>
        </div>
        <BookOpenCheckIcon />
      </section>

      <section v-if="studyDashboard.hasLearningEvidence" class="learning-overview">
        <article>
          <span>已学考点</span>
          <strong>{{ studyDashboard.completedPointCount }}</strong>
          <em>{{ studyDashboard.trackedPointCount }} 个有学习记录</em>
        </article>
        <article>
          <span>待学考点</span>
          <strong>{{ pendingWeakPoints.length }}</strong>
          <em>优先理解突破</em>
        </article>
        <article>
          <span>今日积累</span>
          <strong>{{ digestDone ? '已完成' : '待完成' }}</strong>
          <em>{{ digestCount }} 个条目</em>
        </article>
      </section>

      <section v-if="studyDashboard.hasLearningEvidence" class="section-group">
        <div class="section-title">
          <strong>需要先学透</strong>
          <button type="button" @click="router.push('/vue/study/lecture')">知识体系</button>
        </div>
        <p class="section-context">首页按模块判断能力差距，这里下钻到细分考点安排讲解。</p>
        <div v-if="weakPoints.length" class="weak-list">
          <article v-for="point in weakPoints" :key="`${point.module}-${point.name}`" class="weak-row">
            <button class="weak-main" type="button" @click="learn(point)">
              <span>
                <strong>{{ point.name }}</strong>
                <em>{{ point.module }} · {{ point.reason }}</em>
              </span>
              <b>{{ point.evidenceScore }}%</b>
            </button>
            <div class="weak-actions">
              <button type="button" title="我已掌握，降低推荐优先级" @click="requestPreference(point, 'deprioritized')">
                <CheckCircle2Icon /><span>已会</span>
              </button>
              <button type="button" title="七天内暂不推荐" @click="requestPreference(point, 'paused')">
                <PauseCircleIcon /><span>暂缓</span>
              </button>
            </div>
          </article>
        </div>
        <AppStateView v-else compact title="当前重点已学" description="阅读完成不等于掌握，请到刷题中心用真实作答验证；新的薄弱考点会继续补入。" />
      </section>

      <section class="section-group">
        <div class="section-title">
          <strong>知识学习</strong>
          <span>输入与理解</span>
        </div>
        <div class="feature-grid">
          <button v-for="item in learningItems" :key="item.title" type="button" @click="router.push(item.to)">
            <i :class="item.tone"><component :is="item.icon" /></i>
            <strong>{{ item.title }}</strong>
            <span>{{ item.description }}</span>
          </button>
        </div>
      </section>

      <section class="section-group">
        <div class="section-title">
          <strong>回顾与巩固</strong>
          <span>理解、练习与节奏回看</span>
        </div>
        <div class="practice-list">
          <button v-for="item in practiceItems" :key="item.title" type="button" @click="router.push(item.to)">
            <i :class="item.tone"><component :is="item.icon" /></i>
            <span>
              <strong>{{ item.title }}</strong>
              <em>{{ item.description }}</em>
            </span>
            <ChevronRightIcon />
          </button>
        </div>
      </section>
      <p v-if="loadError" class="refresh-warning">刷新失败，当前仍显示上一次的学习建议。</p>
      </template>
    </PullToRefresh>

    <ConfirmDialog
      v-model="preferenceDialogOpen"
      :title="preferenceDialogTitle"
      :description="preferenceDialogDescription"
      :confirm-text="preferenceMode === 'paused' ? '暂缓 7 天' : '降低优先级'"
      @confirm="applyPreference"
    />
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
  CheckCircle2Icon,
  ChevronRightIcon,
  FileTextIcon,
  LandmarkIcon,
  MapIcon,
  PauseCircleIcon,
  TargetIcon
} from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
import ConfirmDialog from '@/components/layout/ConfirmDialog.vue';
import { AppStateView, PullToRefresh } from '@/capabilities/design-system/public';
import { digestService } from '@/services/DigestService';
import { studyService, type StudyDashboard, type StudyPoint } from '@/services/StudyService';
import { essayCenterLocation } from '@/features/practice/EssayNavigation';
import { CapabilityRecommendationMode } from '@/modules/mastery/public';

const router = useRouter();
const studyDashboard = ref<StudyDashboard | null>(null);
const digestCount = ref(0);
const digestCompleted = ref(false);
const isLoading = ref(false);
const loadError = ref('');
const preferenceDialogOpen = ref(false);
const preferencePoint = ref<StudyPoint>();
const preferenceMode = ref<'deprioritized' | 'paused'>('deprioritized');

const pendingWeakPoints = computed(() => (studyDashboard.value?.weakPoints || [])
  .filter((point) => point.learningStatus !== 'completed'));
const weakPoints = computed(() => pendingWeakPoints.value.slice(0, 4));
const learnedWeakPoint = computed(() => (studyDashboard.value?.weakPoints || [])
  .find((point) => point.learningStatus === 'completed'));
const digestDone = computed(() => digestCompleted.value);
const preferenceDialogTitle = computed(() => preferenceMode.value === 'paused'
  ? `暂缓「${preferencePoint.value?.name || '该考点'}」`
  : `降低「${preferencePoint.value?.name || '该考点'}」优先级`);
const preferenceDialogDescription = computed(() => preferenceMode.value === 'paused'
  ? '七天内不再主动推荐该考点，不会修改已有能力数据。'
  : '系统会尊重你的判断并降低推荐优先级，但仍会根据后续真实作答重新校准。');
const learningDecision = computed(() => {
  if (!studyDashboard.value?.hasLearningEvidence) {
    return {
      title: '先建立可信能力基线',
      detail: '完成一组短诊断后，系统才能区分未接触和真实薄弱，再为你安排针对性讲解。'
    };
  }
  const first = weakPoints.value[0];
  if (first) {
    return {
      title: `今天先理解「${first.name}」`,
      detail: `${first.module} 当前存在能力缺口。先看概念、边界和方法，再去刷题中心完成学后练习${digestDone.value ? '。' : '；今日积累也尚未完成。'}`
    };
  }
  if (!digestDone.value) {
    return {
      title: '完成今日积累，保持持续输入',
      detail: '补充时政热点和知识点输入，积累会作为后续讲解与训练的内容背景。'
    };
  }
  if (learnedWeakPoint.value) {
    return {
      title: `「${learnedWeakPoint.value.name}」已学，下一步用题目验证`,
      detail: '讲义阅读已经记录，但不会直接提高掌握度。完成一组配套练习后，系统会根据真实作答继续调整。'
    };
  }
  return {
    title: '知识输入已完成，适合学后巩固',
    detail: '可以回顾知识地图，确认理解边界，再到刷题中心用真实作答验证掌握情况。'
  };
});

const learningItems = [
  { title: '考点精讲', description: '按知识点学习概念、边界和方法', icon: BookOpenIcon, tone: 'green', to: '/vue/study/lecture' },
  { title: '每日积累', description: '沉淀时政热点和公考知识', icon: LandmarkIcon, tone: 'blue', to: '/vue/digest' },
  { title: '知识地图', description: '按大纲查看知识结构和掌握情况', icon: MapIcon, tone: 'purple', to: '/vue/knowledge-graph' },
  { title: '申论中心', description: '学习材料阅读、题型方法和表达结构', icon: FileTextIcon, tone: 'orange', to: essayCenterLocation('tutor') }
];

const practiceItems = [
  { title: '进入刷题中心', description: '选择私教学习或自主刷题验证掌握', icon: TargetIcon, tone: 'blue', to: '/vue/practice' },
  { title: '错题复盘', description: '回看错因、解析和待巩固知识点', icon: BookMarkedIcon, tone: 'red', to: '/vue/wrongbook' },
  { title: '学习日历', description: '回看学习输入、练习与复习节奏', icon: CalendarDaysIcon, tone: 'gray', to: '/vue/calendar' }
];

onMounted(loadDashboard);

async function loadDashboard() {
  if (!studyDashboard.value) isLoading.value = true;
  loadError.value = '';
  try {
    const [study, digest] = await Promise.all([
      studyService.dashboard(),
      digestService.learningSummary()
    ]);
    studyDashboard.value = study;
    digestCount.value = digest.contentCount;
    digestCompleted.value = digest.isCompleted;
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '学习中心加载失败';
  } finally {
    isLoading.value = false;
  }
}

async function learn(point: StudyPoint) {
  const result = await studyService.startLearning(point);
  await router.push({
    path: '/vue/study/lecture',
    query: {
      taskId: result.task.id,
      capabilityNodeId: point.capabilityNodeId,
      source: 'learning-center'
    }
  });
}

function requestPreference(point: StudyPoint, mode: 'deprioritized' | 'paused') {
  preferencePoint.value = point;
  preferenceMode.value = mode;
  preferenceDialogOpen.value = true;
}

async function applyPreference() {
  const point = preferencePoint.value;
  if (!point) return;
  preferenceDialogOpen.value = false;
  await studyService.setRecommendationPreference({
    capabilityNodeId: point.capabilityNodeId,
    mode: preferenceMode.value === 'paused'
      ? CapabilityRecommendationMode.Paused
      : CapabilityRecommendationMode.Deprioritized
  });
  await loadDashboard();
}
</script>

<style scoped>
.learning-center { height:100%; min-height:0; overflow:hidden; }
.learning-scroll { display:flex; flex-direction:column; gap:17px; padding-top:12px; }
.retry-button { min-height:34px; border:0; border-radius:10px; padding:0 14px; color:#fff; background:var(--primary-color); font:inherit; font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }
.learning-hero { min-height:118px; border-radius:var(--radius-card); padding:17px; display:grid; grid-template-columns:minmax(0,1fr) 38px; gap:12px; align-items:center; background:var(--surface-feature-tutor); box-shadow:var(--shadow-card); }
.learning-hero>div { min-width:0; }
.learning-hero span { color:var(--primary-color); font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }
.learning-hero strong { display:block; margin-top:5px; font-size:var(--type-size-section-title); line-height:1.35; }
.learning-hero p { margin:7px 0 0; color:var(--text-secondary-color); font-size:var(--type-size-secondary); line-height:1.5; }
.learning-hero>svg { width:34px; height:34px; color:var(--primary-color); }
.baseline-action { min-height:34px; margin-top:11px; border:0; border-radius:11px; padding:0 14px; color:#fff; background:var(--primary-color); font:inherit; font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }
.learning-overview { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
.learning-overview article { min-width:0; border-radius:var(--radius-card); padding:10px 8px; background:rgba(var(--color-surface-rgb),.58); text-align:center; }
.learning-overview span,.learning-overview em { display:block; overflow:hidden; color:var(--text-secondary-color); font-size:var(--type-size-micro); font-style:normal; text-overflow:ellipsis; white-space:nowrap; }
.learning-overview strong { display:block; margin:5px 0 3px; font-size:var(--type-size-body-large); }
.section-group { display:flex; flex-direction:column; gap:9px; }
.section-title { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.section-title strong { font-size:var(--type-size-body-large); }
.section-title span,.section-title button { border:0; padding:3px; color:var(--text-secondary-color); background:transparent; font:inherit; font-size:var(--type-size-micro); font-weight:var(--type-weight-semibold); }
.section-context { margin:-3px 0 1px; color:var(--text-secondary-color); font-size:var(--type-size-caption); line-height:1.45; }
.refresh-warning { margin:0; text-align:center; color:var(--text-secondary-color); font-size:var(--type-size-micro); }
.weak-list,.practice-list { overflow:hidden; border-radius:var(--radius-card); background:rgba(var(--color-surface-rgb),.56); box-shadow:var(--shadow-card); }
.weak-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; border-top:1px solid rgba(var(--color-ink-rgb),.055); }
.weak-row:first-child { border-top:0; }
.weak-main,.practice-list button { width:100%; min-height:62px; border:0; padding:10px 12px; display:flex; align-items:center; gap:10px; color:inherit; background:transparent; text-align:left; font:inherit; }
.practice-list button { border-top:1px solid rgba(var(--color-ink-rgb),.055); }
.practice-list button:first-child { border-top:0; }
.weak-main>span,.practice-list button>span { min-width:0; flex:1; }
.weak-list strong,.weak-list em,.practice-list strong,.practice-list em { display:block; overflow:hidden; text-overflow:ellipsis; }
.weak-list strong,.practice-list strong { font-size:var(--type-size-secondary); white-space:nowrap; }
.weak-list em,.practice-list em { margin-top:3px; color:var(--text-secondary-color); font-size:var(--type-size-caption); font-style:normal; line-height:1.4; }
.weak-list b { flex:0 0 auto; border-radius:999px; padding:4px 8px; color:var(--orange-color); background:rgba(255,149,0,.11); font-size:var(--type-size-micro); }
.weak-actions { display:flex; align-items:center; gap:2px; padding-right:7px; }
.weak-actions button { min-width:42px; min-height:42px; border:0; padding:4px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; color:var(--text-secondary-color); background:transparent; font:inherit; font-size:var(--type-size-micro); }
.weak-actions svg { width:15px; height:15px; }
.feature-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
.feature-grid button { min-height:112px; border:0; border-radius:var(--radius-card); padding:12px; display:flex; flex-direction:column; align-items:flex-start; gap:7px; color:inherit; background:rgba(var(--color-surface-rgb),.6); box-shadow:var(--shadow-card); text-align:left; font:inherit; }
.feature-grid i,.practice-list i { width:34px; height:34px; border-radius:11px; display:grid; place-items:center; flex:0 0 auto; }
.feature-grid svg,.practice-list i svg { width:18px; height:18px; }
.feature-grid strong { font-size:var(--type-size-body); }
.feature-grid span { color:var(--text-secondary-color); font-size:var(--type-size-caption); line-height:1.4; }
.practice-list>button>svg { width:16px; height:16px; color:var(--text-secondary-color); }
.green { color:var(--green-color); background:rgba(52,199,89,.11); }
.blue { color:var(--primary-color); background:rgba(var(--color-brand-rgb),.11); }
.orange { color:var(--orange-color); background:rgba(255,149,0,.11); }
.purple { color:var(--purple-color); background:rgba(175,82,222,.1); }
.red { color:var(--red-color); background:rgba(255,59,48,.1); }
.gray { color:var(--text-secondary-color); background:rgba(var(--color-ink-rgb),.065); }
</style>
