<template>
  <div class="study-page app-page">
    <PageHeader :title="lectureTitle || '考点精讲'" :meta="lectureTitle ? 'AI 私教讲义' : activeModuleLabel || '按大纲学习和补弱'">
      <template #actions>
        <HeaderMoreMenu title="精讲设置" subtitle="筛选模块">
          <div class="menu-field">
            <span>模块筛选</span>
            <div class="module-filter-options">
              <button type="button" :class="{ active: activeModule === '' }" @click="activeModule = ''">全部模块</button>
              <button
                v-for="module in dashboard?.modules || []"
                :key="module.name"
                type="button"
                :class="{ active: activeModule === module.name }"
                @click="activeModule = module.name"
              >
                {{ practiceModuleLabel(module.name) }}
              </button>
            </div>
          </div>
        </HeaderMoreMenu>
      </template>
    </PageHeader>

    <PullToRefresh class="study-content" :on-refresh="load">
      <AppStateView v-if="isLoading" state="loading" title="加载考点精讲" />
      <AiTaskPendingState
        v-else-if="visibleTask"
        :task="visibleTask"
        title="AI 正在准备考点精讲"
        :description="visibleTask.message || visibleTask.detail || '正在整理知识结构与典型例题。'"
        retry-action-label="重新生成"
        @retry="startPlanLecture"
        @cancel="cancelGeneration"
      />
      <template v-else-if="lectureContent">
        <LectureContent :markdown="lectureContent" surface />
        <button
          v-if="!lectureCompleted"
          type="button"
          class="complete-learning-button"
          :disabled="isCompleting"
          @click="completeLecture"
        >
          <CheckCircle2Icon />{{ isCompleting ? '正在更新计划' : '完成本节' }}
        </button>
        <p v-else class="completion-notice"><CheckCircle2Icon />本节已完成，下一步请用练习验证掌握</p>
      </template>
      <template v-else-if="dashboard">
        <section class="study-hero app-card">
          <div>
            <span>AI 精讲</span>
            <strong>搜索考点，生成一份可复盘讲义</strong>
          </div>
          <div class="search-row">
            <SearchIcon />
            <input v-model.trim="query" placeholder="搜索考点或输入疑问" @keyup.enter="learnQuery" />
            <button type="button" @click="learnQuery">开始</button>
          </div>
        </section>

        <section class="panel app-card lecture-library">
          <SectionHeading title="我的讲义" :meta="`${lectures.length} 份`" />
          <AppStateView
            v-if="!lectures.length"
            compact
            title="还没有生成讲义"
            description="从薄弱考点或搜索框发起精讲，生成完成后会保存在这里。"
          />
          <template v-else>
            <button v-for="lecture in lectures" :key="lecture.id" type="button" class="lecture-row" @click="openLecture(lecture.id, lecture.capabilityNodeId)">
              <i><BookOpenIcon /></i>
              <span>
                <strong>{{ lecture.title }}</strong>
                <em>{{ practiceModuleLabel(lecture.module) }} · {{ formatLectureTime(lecture.updatedAt) }}</em>
              </span>
              <ChevronRightIcon />
            </button>
          </template>
        </section>

        <section class="panel app-card">
          <SectionHeading title="薄弱考点" :meta="`${dashboard.weakPoints.length} 个需加强`" />
          <div v-if="!dashboard.weakPoints.length" class="inline-empty">完成练习后自动显示薄弱考点</div>
          <button v-for="(point, index) in dashboard.weakPoints" :key="`${point.module}-${point.name}`" type="button" class="weak-card" @click="learn(point)">
            <i :class="index === 0 ? 'danger' : index < 3 ? 'warn' : 'info'">{{ index + 1 }}</i>
            <div><strong>{{ point.name }}</strong><span>{{ practiceModuleLabel(point.module) }} · {{ point.reason }}</span></div>
            <em>{{ point.evidenceScore }}%</em>
          </button>
        </section>

        <section class="panel app-card">
          <SectionHeading title="知识体系" :meta="`${visibleModules.length} 个模块`" />
          <article v-for="module in visibleModules" :key="module.name" class="tree-module">
            <button type="button" class="tree-head" @click="toggle(module.name)">
              <BookOpenIcon /><strong>{{ practiceModuleLabel(module.name) }}</strong><span>{{ module.total }} 个考点</span>
            </button>
            <div v-show="opened.has(module.name)" class="tree-body">
              <div v-for="group in module.groups" :key="group.name" class="tree-group">
                <b>{{ group.name }}</b>
                <div>
                  <button v-for="point in group.points" :key="point.name" type="button" @click="learn(point)">
                    {{ point.name }}<span v-if="point.wrongCount">{{ point.wrongCount }}</span>
                  </button>
                </div>
              </div>
            </div>
          </article>
        </section>
      </template>
    </PullToRefresh>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { BookOpenIcon, CheckCircle2Icon, ChevronRightIcon, SearchIcon } from 'lucide-vue-next';
import { initializeTutorRuntime } from '@/composition-root/public';
import {
  studyLectureDisplayTitle,
  studyService,
  type StudyDashboard,
  type StudyLectureSummary,
  type StudyPoint
} from '@/services/StudyService';
import { practiceModuleLabel } from '@/domain/labels';
import PageHeader from '@/components/layout/PageHeader.vue';
import HeaderMoreMenu from '@/components/layout/HeaderMoreMenu.vue';
import { AppStateView, PullToRefresh, SectionHeading } from '@/capabilities/design-system/public';
import LectureContent from '@/components/content/LectureContent.vue';
import AiTaskPendingState from '@/components/AiTaskPendingState.vue';
import type { AgentRunView } from '@/modules/agent/public';
import { useTaskCenterStore } from '@/stores/taskCenter';

const taskCenter = useTaskCenterStore();
const route = useRoute();
const router = useRouter();
const dashboard = ref<StudyDashboard | null>(null);
const lectures = ref<StudyLectureSummary[]>([]);
const isLoading = ref(false);
const query = ref('');
const activeModule = ref('');
const opened = reactive(new Set<string>());
const lectureContent = ref('');
const lectureTitle = ref('');
const trackedTaskId = ref('');
const taskSnapshot = ref<AgentRunView>();
const isDispatching = ref(false);
const isCompleting = ref(false);
const lectureCompleted = ref(false);
const loadedCapabilityNodeId = ref('');

const dailyPlanItemId = computed(() => typeof route.query.dailyPlanItemId === 'string' ? route.query.dailyPlanItemId : '');
const capabilityNodeId = computed(() => typeof route.query.capabilityNodeId === 'string' ? route.query.capabilityNodeId : '');
const activeModuleLabel = computed(() => activeModule.value ? practiceModuleLabel(activeModule.value) : '');
const visibleTask = computed(() => {
  const task = taskCenter.runs.find((candidate) => candidate.id === trackedTaskId.value)
    || (taskSnapshot.value?.id === trackedTaskId.value ? taskSnapshot.value : undefined);
  return task && (task.isActive || task.status === 'failed' || task.status === 'cancelled') ? task : undefined;
});

const visibleModules = computed(() => {
  const modules = dashboard.value?.modules || [];
  return activeModule.value ? modules.filter((module) => module.name === activeModule.value) : modules;
});

onMounted(async () => {
  taskCenter.connect();
  await taskCenter.refresh();
});

onBeforeUnmount(() => taskCenter.disconnect());

watch(() => [route.query.assetId, route.query.dailyPlanItemId, route.query.start, route.query.taskId], load, { immediate: true });
watch(() => taskCenter.runs.find((task) => task.id === trackedTaskId.value), async (task) => {
  if (!task) return;
  taskSnapshot.value = task;
  if (task.status !== 'completed') return;
  const assetId = typeof task.actionParams.assetId === 'string' ? task.actionParams.assetId : '';
  const nextCapabilityNodeId = typeof task.actionParams.capabilityNodeId === 'string'
    ? task.actionParams.capabilityNodeId
    : capabilityNodeId.value;
  trackedTaskId.value = '';
  taskSnapshot.value = undefined;
  if (!assetId) return;
  await router.replace({
    path: '/vue/study/lecture',
    query: {
      assetId,
      ...(dailyPlanItemId.value ? { dailyPlanItemId: dailyPlanItemId.value } : {}),
      ...(nextCapabilityNodeId ? { capabilityNodeId: nextCapabilityNodeId } : {}),
      source: route.query.source || 'daily-plan'
    }
  });
});

async function load() {
  isLoading.value = true;
  try {
    const taskId = typeof route.query.taskId === 'string' ? route.query.taskId : '';
    if (taskId) {
      trackedTaskId.value = taskId;
      taskSnapshot.value = taskCenter.runs.find((task) => task.id === taskId);
    }
    lectureContent.value = '';
    lectureTitle.value = '';
    lectureCompleted.value = false;
    loadedCapabilityNodeId.value = '';
    const assetId = typeof route.query.assetId === 'string' ? route.query.assetId : '';
    if (assetId) {
      const runtime = await initializeTutorRuntime();
      const asset = await runtime.learningAssetStore.find(assetId);
      lectureContent.value = typeof asset?.payload.content === 'string' ? asset.payload.content : '';
      const sourceModule = typeof asset?.payload.moduleCode === 'string'
        ? asset.payload.moduleCode
        : typeof asset?.payload.module === 'string' ? asset.payload.module : '';
      const moduleLabel = typeof asset?.payload.moduleLabel === 'string'
        ? asset.payload.moduleLabel
        : practiceModuleLabel(sourceModule);
      lectureTitle.value = asset?.title
        ? studyLectureDisplayTitle(asset.title, sourceModule, moduleLabel)
        : '';
      const assetCapabilityNodeId = typeof asset?.payload.capabilityNodeId === 'string'
        ? asset.payload.capabilityNodeId
        : capabilityNodeId.value || undefined;
      loadedCapabilityNodeId.value = assetCapabilityNodeId || '';
      if (lectureContent.value) {
        const progress = await studyService.markLectureStarted({
          assetId,
          capabilityNodeId: assetCapabilityNodeId,
          dailyPlanItemId: dailyPlanItemId.value || undefined
        });
        lectureCompleted.value = progress?.status === 'completed';
        return;
      }
    }
    if (route.query.start === '1' && dailyPlanItemId.value) {
      await startPlanLecture();
      return;
    }
    const [nextDashboard, nextLectures] = await Promise.all([
      studyService.dashboard(),
      studyService.listLectures()
    ]);
    dashboard.value = nextDashboard;
    lectures.value = nextLectures;
    if (!opened.size && dashboard.value.modules[0]) opened.add(dashboard.value.modules[0].name);
  } finally {
    isLoading.value = false;
  }
}

async function startPlanLecture() {
  if (isDispatching.value || visibleTask.value?.isActive || !dailyPlanItemId.value) return;
  isDispatching.value = true;
  try {
    const result = await studyService.startDailyPlanLecture({
      dailyPlanItemId: dailyPlanItemId.value,
      capabilityNodeId: capabilityNodeId.value || undefined
    });
    trackedTaskId.value = result.task.id;
    taskSnapshot.value = result.task;
    await taskCenter.refresh();
  } finally {
    isDispatching.value = false;
  }
}

async function cancelGeneration() {
  if (!visibleTask.value) return;
  const runtime = await initializeTutorRuntime();
  await runtime.cancelAgentRun.execute({
    agentRunId: visibleTask.value.id,
    reason: 'user_cancelled_daily_plan_lecture'
  });
  await taskCenter.refresh();
}

async function completeLecture() {
  const assetId = typeof route.query.assetId === 'string' ? route.query.assetId : '';
  if (!assetId || isCompleting.value) return;
  isCompleting.value = true;
  try {
    await studyService.completeLecture({
      dailyPlanItemId: dailyPlanItemId.value || undefined,
      capabilityNodeId: loadedCapabilityNodeId.value || capabilityNodeId.value || undefined,
      assetId
    });
    lectureCompleted.value = true;
  } finally {
    isCompleting.value = false;
  }
}

async function openLecture(assetId: string, capabilityNodeId?: string) {
  await router.push({
    path: '/vue/study/lecture',
    query: { assetId, ...(capabilityNodeId ? { capabilityNodeId } : {}) }
  });
}

function formatLectureTime(value: number): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function toggle(moduleName: string) {
  if (opened.has(moduleName)) opened.delete(moduleName);
  else opened.add(moduleName);
}

async function learn(point: StudyPoint) {
  const result = await studyService.startLearning(point);
  trackedTaskId.value = result.task.id;
  taskSnapshot.value = result.task;
  query.value = point.name;
  await taskCenter.refresh();
}

async function learnQuery() {
  if (!query.value) return;
  const result = await studyService.startLearning({ module: activeModule.value || undefined, name: query.value });
  trackedTaskId.value = result.task.id;
  taskSnapshot.value = result.task;
  await taskCenter.refresh();
}

</script>

<style scoped>
.study-content { display: flex; flex-direction: column; gap: 14px; }
.study-hero { padding: 14px; display: flex; flex-direction: column; gap: 12px; background: rgba(255,255,255,.78); }
.study-hero > div:first-child { display: flex; flex-direction: column; gap: 4px; }
.study-hero span { color: var(--primary-color); font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); }
.study-hero strong { color: var(--text-color); font-size: var(--type-size-section-title); line-height: 1.3; }
.search-row { min-height: 42px; display: flex; align-items: center; gap: 8px; padding: 0 6px 0 11px; border-radius: 13px; background: rgba(245,246,250,.9); border: 1px solid rgba(var(--color-ink-rgb), .06); }
.search-row svg { width: 17px; height: 17px; color: var(--text-secondary-color); flex-shrink: 0; }
.search-row input { min-width: 0; flex: 1; height: 40px; border: 0; outline: 0; background: transparent; color: var(--text-color); font: inherit; font-size: var(--type-size-body); }
.search-row button { width: 58px; height: 32px; border: 0; border-radius: 11px; background: var(--primary-color); color: #fff; font-size: var(--type-size-secondary); font-weight: var(--type-weight-semibold); font-family: inherit; }
.menu-field { display: flex; flex-direction: column; gap: 8px; padding: 11px 12px 12px; border-radius: 12px; background: rgba(var(--color-ink-rgb), .055); }
.menu-field span { color: var(--text-secondary-color); font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); }
.module-filter-options { display:flex; flex-wrap:wrap; gap:7px; }
.module-filter-options button { min-height:31px; border:0; border-radius:999px; padding:0 10px; background:rgba(255,255,255,.76); color:var(--text-secondary-color); font:inherit; font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }
.module-filter-options button.active { background:rgba(var(--color-brand-rgb), .12); color:var(--primary-color); }
.empty-state { min-height: 180px; border-radius: 14px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.72); color: var(--text-secondary-color); font-size: var(--type-size-secondary); }
.panel { padding: 14px; }
.weak-card,.tree-head { display:flex; align-items:center; }
.section-heading { margin-bottom:10px; }
.inline-empty { padding:14px; text-align:center; color:var(--text-secondary-color); font-size: var(--type-size-secondary); }
.lecture-library { overflow:hidden; }
.lecture-row { width:100%; min-height:62px; border:0; border-top:1px solid rgba(var(--color-ink-rgb),.06); padding:10px 0; display:flex; align-items:center; gap:10px; color:inherit; background:transparent; text-align:left; font:inherit; }
.lecture-row>i { width:34px; height:34px; border-radius:11px; display:grid; place-items:center; flex:0 0 auto; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.1); }
.lecture-row>i svg,.lecture-row>svg { width:17px; height:17px; }
.lecture-row>span { min-width:0; flex:1; }
.lecture-row strong,.lecture-row em { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.lecture-row strong { font-size:var(--type-size-secondary); }
.lecture-row em { margin-top:4px; color:var(--text-secondary-color); font-size:var(--type-size-micro); font-style:normal; }
.lecture-row>svg { flex:0 0 auto; color:var(--text-secondary-color); }
.weak-card { width:100%; gap:10px; padding:12px 0; border:0; border-top:1px solid rgba(var(--color-ink-rgb), .07); background:transparent; text-align:left; font-family: inherit; }
.weak-card i { width:30px; height:30px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-style:normal; font-weight: var(--type-weight-semibold); flex-shrink: 0; }
.weak-card i.danger { background:rgba(239,68,68,.12); color:#dc2626; }
.weak-card i.warn { background:rgba(245,158,11,.13); color:#d97706; }
.weak-card i.info { background:rgba(37,99,235,.1); color:var(--color-brand); }
.weak-card div { min-width:0; flex:1; }
.weak-card strong,.weak-card span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.weak-card strong { font-size: var(--type-size-body); }
.weak-card span { margin-top:3px; color:var(--text-secondary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); }
.weak-card em { font-size: var(--type-size-caption); font-style:normal; font-weight: var(--type-weight-semibold); color:var(--primary-color); }
.tree-module { border-top:1px solid rgba(var(--color-ink-rgb), .07); }
.tree-head { width:100%; gap:9px; padding:13px 0; border:0; background:transparent; text-align:left; font-family: inherit; }
.tree-head svg { width:17px; height:17px; color:var(--primary-color); flex-shrink: 0; }
.tree-head strong { flex:1; font-size: var(--type-size-body); }
.tree-head span { color:var(--text-secondary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); }
.tree-body { padding:0 0 12px; }
.tree-group { margin-top:10px; }
.tree-group b { display:block; margin-bottom:6px; color:var(--text-secondary-color); font-size: var(--type-size-micro); }
.tree-group div { display:flex; flex-wrap:wrap; gap:7px; }
.tree-group button { max-width:100%; min-height:31px; padding:0 10px; border:0; border-radius:9px; background:rgba(var(--color-ink-rgb), .06); color:var(--text-color); font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); font-family: inherit; }
.tree-group span { display:inline-flex; align-items:center; justify-content:center; min-width:15px; height:15px; margin-left:4px; padding:0 4px; border-radius:8px; background:#dc2626; color:#fff; font-size: var(--type-size-micro); }
.complete-learning-button { align-self:center; min-height:40px; border:0; border-radius:20px; padding:0 18px; display:inline-flex; align-items:center; gap:7px; background:rgba(var(--color-brand-rgb),.13); color:var(--primary-color); font:inherit; font-size:var(--type-size-secondary); font-weight:var(--type-weight-semibold); }
.complete-learning-button svg,.completion-notice svg { width:16px; height:16px; }
.completion-notice { margin:0; display:flex; align-items:center; justify-content:center; gap:7px; color:var(--primary-color); font-size:var(--type-size-caption); }
</style>
