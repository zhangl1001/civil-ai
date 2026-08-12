<template>
  <div class="learning-center app-page">
    <PageHeader title="学习中心" meta="知识学习、每日积累与学后巩固" />

    <PullToRefresh class="learning-scroll" :on-refresh="loadDashboard">
      <section class="learning-hero">
        <div>
          <span>今日学习建议</span>
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
          <span>待学考点</span>
          <strong>{{ studyDashboard?.weakPoints.length || 0 }}</strong>
          <em>优先理解突破</em>
        </article>
        <article>
          <span>今日积累</span>
          <strong>{{ digestDone ? '已完成' : '待完成' }}</strong>
          <em>{{ digestCount }} 个条目</em>
        </article>
      </section>

      <section class="section-group">
        <div class="section-title">
          <strong>需要先学透</strong>
          <button type="button" @click="router.push('/vue/study/lecture')">全部考点</button>
        </div>
        <div v-if="weakPoints.length" class="weak-list">
          <button v-for="point in weakPoints" :key="`${point.module}-${point.name}`" type="button" @click="learn(point)">
            <span>
              <strong>{{ point.name }}</strong>
              <em>{{ point.module }} · {{ point.reason }}</em>
            </span>
            <b>{{ point.proficiency }}%</b>
          </button>
        </div>
        <AppStateView v-else compact title="暂无明确薄弱考点" description="完成练习并积累证据后，系统会把需要先学透的知识点放在这里。" />
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
          <strong>学后巩固</strong>
          <span>理解后再练</span>
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
  TargetIcon
} from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
import { AppStateView, PullToRefresh } from '@/capabilities/design-system/public';
import { digestService } from '@/services/DigestService';
import { studyService, type StudyDashboard, type StudyPoint } from '@/services/StudyService';
import { essayCenterLocation } from '@/features/practice/EssayNavigation';

const router = useRouter();
const studyDashboard = ref<StudyDashboard | null>(null);
const digestCount = ref(0);
const isLoading = ref(false);

const weakPoints = computed(() => (studyDashboard.value?.weakPoints || []).slice(0, 4));
const digestDone = computed(() => digestCount.value > 0);
const learningDecision = computed(() => {
  const first = weakPoints.value[0];
  if (first) {
    return {
      title: `今天先理解「${first.name}」`,
      detail: `${first.module} 当前存在能力缺口。先看概念、边界和方法，再去刷题中心完成学后练习。`
    };
  }
  if (!digestDone.value) {
    return {
      title: '完成今日积累，保持持续输入',
      detail: '补充时政热点和知识点输入，积累会作为后续讲解与训练的内容背景。'
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
  { title: '申论学习', description: '学习材料阅读、题型方法和表达结构', icon: FileTextIcon, tone: 'orange', to: essayCenterLocation('tutor') }
];

const practiceItems = [
  { title: '进入刷题中心', description: '选择私教学习或自主刷题验证掌握', icon: TargetIcon, tone: 'blue', to: '/vue/practice' },
  { title: '错题复盘', description: '回看错因、解析和待巩固知识点', icon: BookMarkedIcon, tone: 'red', to: '/vue/wrongbook' },
  { title: '学习日历', description: '回看学习输入、练习与复习节奏', icon: CalendarDaysIcon, tone: 'gray', to: '/vue/calendar' }
];

onMounted(loadDashboard);

async function loadDashboard() {
  isLoading.value = true;
  try {
    const [study, digest] = await Promise.all([
      studyService.dashboard(),
      digestService.dashboard('news')
    ]);
    studyDashboard.value = study;
    digestCount.value = digest.sections.length;
  } finally {
    isLoading.value = false;
  }
}

async function learn(point: StudyPoint) {
  await studyService.startLearning(point);
  await router.push('/vue/study/lecture');
}
</script>

<style scoped>
.learning-center { height:100%; min-height:0; overflow:hidden; }
.learning-scroll { display:flex; flex-direction:column; gap:17px; padding-top:12px; }
.learning-hero { min-height:118px; border-radius:var(--radius-card); padding:17px; display:grid; grid-template-columns:minmax(0,1fr) 38px; gap:12px; align-items:center; background:var(--surface-feature-tutor); box-shadow:var(--shadow-card); }
.learning-hero>div { min-width:0; }
.learning-hero span { color:var(--primary-color); font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }
.learning-hero strong { display:block; margin-top:5px; font-size:var(--type-size-section-title); line-height:1.35; }
.learning-hero p { margin:7px 0 0; color:var(--text-secondary-color); font-size:var(--type-size-secondary); line-height:1.5; }
.learning-hero>svg { width:34px; height:34px; color:var(--primary-color); }
.learning-overview { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
.learning-overview article { min-width:0; border-radius:var(--radius-card); padding:10px 8px; background:rgba(var(--color-surface-rgb),.58); text-align:center; }
.learning-overview span,.learning-overview em { display:block; overflow:hidden; color:var(--text-secondary-color); font-size:var(--type-size-micro); font-style:normal; text-overflow:ellipsis; white-space:nowrap; }
.learning-overview strong { display:block; margin:5px 0 3px; font-size:var(--type-size-body-large); }
.section-group { display:flex; flex-direction:column; gap:9px; }
.section-title { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.section-title strong { font-size:var(--type-size-body-large); }
.section-title span,.section-title button { border:0; padding:3px; color:var(--text-secondary-color); background:transparent; font:inherit; font-size:var(--type-size-micro); font-weight:var(--type-weight-semibold); }
.weak-list,.practice-list { overflow:hidden; border-radius:var(--radius-card); background:rgba(var(--color-surface-rgb),.56); box-shadow:var(--shadow-card); }
.weak-list button,.practice-list button { width:100%; min-height:62px; border:0; border-top:1px solid rgba(var(--color-ink-rgb),.055); padding:10px 12px; display:flex; align-items:center; gap:10px; color:inherit; background:transparent; text-align:left; font:inherit; }
.weak-list button:first-child,.practice-list button:first-child { border-top:0; }
.weak-list button>span,.practice-list button>span { min-width:0; flex:1; }
.weak-list strong,.weak-list em,.practice-list strong,.practice-list em { display:block; overflow:hidden; text-overflow:ellipsis; }
.weak-list strong,.practice-list strong { font-size:var(--type-size-secondary); white-space:nowrap; }
.weak-list em,.practice-list em { margin-top:3px; color:var(--text-secondary-color); font-size:var(--type-size-caption); font-style:normal; line-height:1.4; }
.weak-list b { flex:0 0 auto; border-radius:999px; padding:4px 8px; color:var(--orange-color); background:rgba(255,149,0,.11); font-size:var(--type-size-micro); }
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
