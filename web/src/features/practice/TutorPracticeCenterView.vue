<template>
  <div class="practice-center app-page">
    <PageHeader title="刷题中心" :meta="cycleName" />

    <PullToRefresh class="practice-scroll" :on-refresh="load">
      <section class="section-block">
        <div :class="['mode-intro', `mode-${activeMode}`]">
          <div class="mode-intro-copy">
            <small>{{ modeIntroEyebrow }}</small>
            <strong>{{ modeIntroTitle }}</strong>
            <p>{{ modeIntroDescription }}</p>
          </div>
          <nav class="practice-tabs" aria-label="刷题模式">
            <button type="button" :class="{ active: activeMode === 'tutor' }" @click="activeMode = 'tutor'">
              <SparklesIcon />私教学习
            </button>
            <button type="button" :class="{ active: activeMode === 'self' }" @click="activeMode = 'self'">
              <SlidersHorizontalIcon />自主刷题
            </button>
            <button type="button" :class="{ active: activeMode === 'true' }" @click="activeMode = 'true'">
              <LandmarkIcon />真题练习
            </button>
          </nav>
        </div>

        <AiTaskPendingState
          v-if="activeTask?.isActive"
          :task="activeTask"
          :title="activeTask.title"
          :description="activeTask.detail"
          hide-primary-action
          @cancel="cancelCurrentTask"
        />

        <div v-else-if="activeMode !== 'true'" class="generation-panel">
          <button
            v-if="activeMode === 'tutor'"
            type="button"
            class="generation-card tutor"
            :disabled="!tutorPrescription || launching"
            @click="startTutorPractice"
          >
            <i><SparklesIcon /></i>
            <span>
              <small>今日教学动作</small>
              <strong>{{ tutorPrescription?.title || '正在读取今日训练' }}</strong>
              <em>{{ tutorDescription }}</em>
            </span>
            <ChevronRightIcon />
          </button>
          <div v-else class="self-generation-options">
            <button
              type="button"
              class="generation-card self"
              :disabled="loading || !capabilities.length || launching"
              @click="showCustomSheet = true"
            >
              <i><SlidersHorizontalIcon /></i>
              <span>
                <small>行测自定义</small>
                <strong>选择模块和细分考点</strong>
                <em>判断、言语、资料、数量与常识专项</em>
              </span>
              <ChevronRightIcon />
            </button>
            <button
              type="button"
              class="generation-card essay"
              :disabled="launching"
              @click="openEssayPractice"
            >
              <i><FilePenLineIcon /></i>
              <span>
                <small>申论训练</small>
                <strong>材料阅读、作答与批改</strong>
                <em>选择题型后生成对应讲义和练习</em>
              </span>
              <ChevronRightIcon />
            </button>
          </div>
        </div>
        <TrueQuestionLibraryActions
          v-else
          :filter-summary="trueQuestionFilterSummary"
          :practice-count="truePracticeCount"
          :set-count="filteredTrueQuestionSets.length"
          :completed-count="completedTrueQuestionCount"
          :launching="launching"
          :importing="importingTrueQuestion"
          @filter="showTrueFilterSheet = true"
          @import-file="importTrueQuestion"
          @research="researchTrueQuestions(trueQuestionFilterSummary)"
          @special="startTrueQuestionPractice('special')"
          @retest="startTrueQuestionPractice('retest')"
        />
        <p v-if="error" class="page-error">{{ error }}</p>
      </section>

      <section class="section-block">
        <div class="section-heading">
          <div>
            <strong>{{ listHeading }}</strong>
            <span>{{ listDescription }}</span>
          </div>
          <button type="button" class="text-action" @click="router.push('/vue/wrongbook')">错题本</button>
        </div>
        <InitialRefreshState v-if="loading" compact label="正在刷新题组" />
        <AppStateView
          v-else-if="!visibleSets.length"
          compact
          :title="emptyTitle"
          :description="emptyDescription"
        />
        <InfiniteScrollPagination v-else :has-more="activeMode === 'true' && trueQuestionVisibleCount < filteredTrueQuestionSets.length" :has-items="activeMode === 'true' && Boolean(filteredTrueQuestionSets.length)" :on-load-more="loadMoreTrueQuestions">
          <div class="set-list">
            <button
              v-for="set in visibleSets"
              :key="set.id"
              type="button"
              @click="openSet(set)"
            >
              <i>{{ moduleShort(set.module) }}</i>
              <span>
                <strong>{{ setTitle(set) }}</strong>
                <em>
                  <b :class="`status-${set.practiceStatus}`">
                    <CircleCheckIcon v-if="set.practiceStatus === QuestionSetPracticeStatus.Completed" />
                    <Clock3Icon v-else-if="set.practiceStatus === QuestionSetPracticeStatus.InProgress" />
                    <CircleIcon v-else />
                    {{ questionSetPracticeStatusLabel(set.practiceStatus) }}
                  </b>
                  <span>{{ setMeta(set) }}</span>
                </em>
              </span>
              <ChevronRightIcon />
            </button>
          </div>
        </InfiniteScrollPagination>
      </section>
    </PullToRefresh>

    <BottomSheet v-model="showCustomSheet" title="自主刷题" subtitle="按模块、考点和题量生成" variant="filter">
      <div class="custom-sheet">
        <label>
          <span>模块</span>
          <div class="choice-row">
            <button
              v-for="item in availableModules"
              :key="item.code"
              type="button"
              :class="{ active: customModule === item.code }"
              @click="selectModule(item.code)"
            >
              {{ item.name }}
            </button>
          </div>
        </label>
        <label>
          <span>题型</span>
          <div class="choice-row">
            <button
              v-for="item in availableQuestionTypes"
              :key="item.id"
              type="button"
              :class="{ active: customQuestionTypeId === item.id }"
              @click="selectQuestionType(item.id)"
            >
              {{ item.name }}
            </button>
          </div>
        </label>
        <label>
          <span>考点</span>
          <div class="capability-list">
            <button
              v-for="item in filteredCapabilities"
              :key="item.id"
              type="button"
              :class="{ active: customCapabilityId === item.id }"
              @click="customCapabilityId = item.id"
            >
              {{ item.name }}
            </button>
          </div>
        </label>
        <label>
          <span>题量</span>
          <div class="choice-row">
            <button v-for="count in [5, 10, 15, 20, 25]" :key="count" type="button" :class="{ active: customCount === count }" @click="customCount = count">
              {{ count }}题
            </button>
          </div>
        </label>
        <button class="generate-button" type="button" :disabled="launching || !selectedCustomCapability" @click="generateCustom">
          <SparklesIcon />
          {{ launching ? '正在创建任务' : '生成并开始练习' }}
        </button>
      </div>
    </BottomSheet>

    <BottomSheet v-model="showTrueFilterSheet" title="筛选真题" subtitle="只筛选来源元数据，不读取题目正文" variant="filter">
      <div class="custom-sheet">
        <label>
          <span>来源</span>
          <div class="choice-row">
            <button type="button" :class="{ active: trueOriginFilter === 'all' }" @click="trueOriginFilter = 'all'">全部</button>
            <button type="button" :class="{ active: trueOriginFilter === QuestionOriginType.Official }" @click="trueOriginFilter = QuestionOriginType.Official">官方真题</button>
            <button type="button" :class="{ active: trueOriginFilter === QuestionOriginType.Imported }" @click="trueOriginFilter = QuestionOriginType.Imported">导入题</button>
            <button type="button" :class="{ active: trueOriginFilter === QuestionOriginType.UserCreated }" @click="trueOriginFilter = QuestionOriginType.UserCreated">自建题</button>
          </div>
        </label>
        <label v-if="trueQuestionYears.length">
          <span>年份</span>
          <div class="choice-row">
            <button type="button" :class="{ active: !trueYearFilter }" @click="trueYearFilter = 0">全部</button>
            <button v-for="year in trueQuestionYears" :key="year" type="button" :class="{ active: trueYearFilter === year }" @click="trueYearFilter = year">{{ year }}年</button>
          </div>
        </label>
        <label v-if="trueQuestionProvinces.length">
          <span>地区</span>
          <div class="choice-row">
            <button type="button" :class="{ active: !trueProvinceFilter }" @click="trueProvinceFilter = ''">全部</button>
            <button v-for="province in trueQuestionProvinces" :key="province" type="button" :class="{ active: trueProvinceFilter === province }" @click="trueProvinceFilter = province">{{ province }}</button>
          </div>
        </label>
        <label v-if="trueQuestionModules.length">
          <span>模块</span>
          <div class="choice-row">
            <button type="button" :class="{ active: !trueModuleFilter }" @click="trueModuleFilter = ''">全部</button>
            <button v-for="module in trueQuestionModules" :key="module" type="button" :class="{ active: trueModuleFilter === module }" @click="trueModuleFilter = module">{{ moduleLabel(module) }}</button>
          </div>
        </label>
        <label>
          <span>练习状态</span>
          <div class="choice-row">
            <button type="button" :class="{ active: trueStatusFilter === 'all' }" @click="trueStatusFilter = 'all'">全部</button>
            <button type="button" :class="{ active: trueStatusFilter === QuestionSetPracticeStatus.NotStarted }" @click="trueStatusFilter = QuestionSetPracticeStatus.NotStarted">未练习</button>
            <button type="button" :class="{ active: trueStatusFilter === QuestionSetPracticeStatus.InProgress }" @click="trueStatusFilter = QuestionSetPracticeStatus.InProgress">进行中</button>
            <button type="button" :class="{ active: trueStatusFilter === QuestionSetPracticeStatus.Completed }" @click="trueStatusFilter = QuestionSetPracticeStatus.Completed">已完成</button>
          </div>
        </label>
        <label>
          <span>专项题量</span>
          <div class="choice-row">
            <button v-for="count in [5, 10, 15, 20, 25, 30]" :key="count" type="button" :class="{ active: truePracticeCount === count }" @click="truePracticeCount = count">{{ count }}题</button>
          </div>
        </label>
        <div class="filter-footer">
          <button type="button" class="filter-reset" @click="resetTrueQuestionFilters">重置</button>
          <button type="button" class="filter-apply" @click="showTrueFilterSheet = false">
            查看 {{ filteredTrueQuestionSets.length }} 套真题
          </button>
        </div>
      </div>
    </BottomSheet>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleIcon,
  Clock3Icon,
  FilePenLineIcon,
  LandmarkIcon,
  SlidersHorizontalIcon,
  SparklesIcon
} from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import AiTaskPendingState from '@/components/AiTaskPendingState.vue';
import { AppStateView, InfiniteScrollPagination, InitialRefreshState, PullToRefresh } from '@/capabilities/design-system/public';
import { initializeTutorRuntime } from '@/composition-root/public';
import { APTITUDE_PRACTICE_MODULE_OPTIONS, practiceModuleLabel } from '@/domain/labels';
import { AssessmentRole } from '@/kernel/public';
import type { AgentRunView } from '@/modules/agent/public';
import { CapabilityNodeType, type CapabilityNode } from '@/modules/curriculum/public';
import {
  QuestionOriginType,
  QuestionSetEntryMode,
  QuestionSetPracticeStatus,
  questionOriginLabel,
  questionSetLibraryTitle,
  questionSetPracticeStatusLabel,
  type QuestionSetLibraryEntry,
  type QuestionSetPracticeStatusCode
} from '@/modules/content/public';
import type { TutorPracticePrescription } from './TutorDailyPracticeFeature';
import { difficultyFor } from './TutorDailyPracticeFeature';
import { actionQuery, StructuredPracticeTaskCenter } from './StructuredPracticeTaskCenter';
import { PracticeCenterFeature } from './PracticeCenterFeature';
import { TrueQuestionPracticeFeature } from './TrueQuestionPracticeFeature';
import TrueQuestionLibraryActions from './TrueQuestionLibraryActions.vue';
import { useTrueQuestionImport } from './useTrueQuestionImport';

type PracticeMode = 'tutor' | 'self' | 'true';

const route = useRoute();
const router = useRouter();
const loading = ref(true);
const launching = ref(false);
const error = ref('');
const { importingTrueQuestion, importTrueQuestion, researchTrueQuestions } = useTrueQuestionImport((message) => { error.value = message; });
const cycleName = ref('刷题中心');
const generatedSets = ref<readonly QuestionSetLibraryEntry[]>([]);
const trueQuestionSets = ref<readonly QuestionSetLibraryEntry[]>([]);
const curriculumNodes = ref<readonly CapabilityNode[]>([]);
const capabilities = ref<readonly CapabilityNode[]>([]);
const tutorPrescription = ref<TutorPracticePrescription | null>(null);
const activeMode = ref<PracticeMode>(
  route.query.mode === 'true'
    ? 'true'
    : route.query.mode === QuestionSetEntryMode.Self ? QuestionSetEntryMode.Self : QuestionSetEntryMode.Tutor
);
const tutorTask = ref<AgentRunView | null>(null);
const selfTask = ref<AgentRunView | null>(null);
const foregroundTaskId = ref('');
const navigatedTaskId = ref('');
const showCustomSheet = ref(false);
const showTrueFilterSheet = ref(false);
const trueOriginFilter = ref<'all' | typeof QuestionOriginType.Official | typeof QuestionOriginType.Imported | typeof QuestionOriginType.UserCreated>('all');
const trueYearFilter = ref(0);
const trueProvinceFilter = ref('');
const trueModuleFilter = ref('');
const trueStatusFilter = ref<'all' | QuestionSetPracticeStatusCode>('all');
const truePracticeCount = ref(10); const trueQuestionVisibleCount = ref(30);
const customModule = ref('');
const customQuestionTypeId = ref('');
const customCapabilityId = ref('');
const customCount = ref(10);
let pollTimer: number | undefined;
let practiceCenterFeaturePromise: Promise<PracticeCenterFeature> | undefined;
const moduleDefinitions = APTITUDE_PRACTICE_MODULE_OPTIONS;
const curriculumNodesById = computed(() => new Map(curriculumNodes.value.map((item) => [item.id, item])));
const availableModules = computed(() => {
  const available = new Set(capabilities.value.map((item) => item.module));
  return moduleDefinitions.filter((item) => available.has(item.code));
});
const availableQuestionTypes = computed(() => curriculumNodes.value.filter((item) => (
  item.status === 'active'
  && item.subject === 'aptitude'
  && item.module === customModule.value
  && item.nodeType === CapabilityNodeType.QuestionType
)));
const filteredCapabilities = computed(() => capabilities.value.filter((item) => (
  item.module === customModule.value
  && questionTypeIdFor(item) === customQuestionTypeId.value
)));
const selectedCustomCapability = computed(() => capabilities.value.find((item) => item.id === customCapabilityId.value) || null);
const activeTask = computed(() => activeMode.value === 'tutor'
  ? tutorTask.value
  : activeMode.value === 'self' ? selfTask.value : null);
const tutorSets = computed(() => generatedSets.value.filter((set) => set.entryMode === QuestionSetEntryMode.Tutor).slice(0, 12));
const selfSets = computed(() => generatedSets.value.filter((set) => set.entryMode === QuestionSetEntryMode.Self).slice(0, 12));
const filteredTrueQuestionSets = computed(() => trueQuestionSets.value.filter((set) => (
  (trueOriginFilter.value === 'all' || set.originType === trueOriginFilter.value)
  && (!trueYearFilter.value || set.sourceMetadata?.examYear === trueYearFilter.value)
  && (!trueProvinceFilter.value || set.sourceMetadata?.province === trueProvinceFilter.value)
  && (!trueModuleFilter.value || set.module === trueModuleFilter.value)
  && (trueStatusFilter.value === 'all' || set.practiceStatus === trueStatusFilter.value)
)));
const visibleTrueQuestionSets = computed(() => filteredTrueQuestionSets.value.slice(0, trueQuestionVisibleCount.value));
const visibleSets = computed(() => activeMode.value === 'tutor'
  ? tutorSets.value
  : activeMode.value === 'self' ? selfSets.value : visibleTrueQuestionSets.value);
const trueQuestionYears = computed(() => [...new Set(
  trueQuestionSets.value.flatMap((set) => set.sourceMetadata?.examYear ? [set.sourceMetadata.examYear] : [])
)].sort((left, right) => right - left));
const trueQuestionProvinces = computed(() => [...new Set(
  trueQuestionSets.value.flatMap((set) => set.sourceMetadata?.province ? [set.sourceMetadata.province] : [])
)].sort((left, right) => left.localeCompare(right, 'zh-CN')));
const trueQuestionModules = computed(() => [...new Set(trueQuestionSets.value.map((set) => set.module))]);
const completedTrueQuestionCount = computed(() => trueQuestionSets.value.filter((set) => (
  set.practiceStatus === QuestionSetPracticeStatus.Completed
  && (trueOriginFilter.value === 'all' || set.originType === trueOriginFilter.value)
  && (!trueYearFilter.value || set.sourceMetadata?.examYear === trueYearFilter.value)
  && (!trueProvinceFilter.value || set.sourceMetadata?.province === trueProvinceFilter.value)
  && (!trueModuleFilter.value || set.module === trueModuleFilter.value)
)).length);
const tutorDescription = computed(() => {
  const prescription = tutorPrescription.value;
  if (!prescription) return '根据计划、薄弱点和复习节奏生成';
  return `${prescription.requestedCount}题 · ${roleLabel(prescription.assessmentRole)} · ${prescription.description}`;
});
const modeIntroTitle = computed(() => {
  if (activeMode.value === 'true') return '用真实试题校准能力与训练方向';
  if (activeMode.value === QuestionSetEntryMode.Self) return '按自己的节奏选择训练内容';
  return tutorPrescription.value?.title || '正在读取今日私教安排';
});
const modeIntroDescription = computed(() => {
  if (activeMode.value === 'true') {
    return '按年份、地区和来源练习已导入真题，作答结果进入同一套批改、错因与能力证据链。';
  }
  if (activeMode.value === QuestionSetEntryMode.Self) {
    return '自主选择模块、细分考点和题量，生成的题组只保存在自主刷题分类中。';
  }
  return tutorPrescription.value
    ? `根据计划、薄弱点和复习节奏安排：${tutorDescription.value}`
    : '私教会结合当前计划、能力证据和待复习知识点确定训练内容。';
});
const modeIntroEyebrow = computed(() => ({
  tutor: '当前私教主线',
  self: '自主加练',
  true: '真题校准'
})[activeMode.value]);
const listHeading = computed(() => ({
  tutor: '私教题组',
  self: '自主题组',
  true: '真题题库'
})[activeMode.value]);
const listDescription = computed(() => ({
  tutor: '由计划、薄弱点和复习任务生成',
  self: '由你主动选择条件生成',
  true: '官方真题、导入题与自建题独立归档'
})[activeMode.value]);
const emptyTitle = computed(() => ({
  tutor: '还没有私教题组',
  self: '还没有自主题组',
  true: '还没有可练习的真题'
})[activeMode.value]);
const emptyDescription = computed(() => ({
  tutor: '开始今日教学动作后，私教题组会保存在这里。',
  self: '设置模块、考点和题量后，自主题组会保存在这里。',
  true: '通过 AI 对话导入并确认题目后，真题会按来源归档在这里。'
})[activeMode.value]);
const trueQuestionFilterSummary = computed(() => {
  const filters = [
    trueOriginFilter.value === 'all' ? '' : questionOriginLabel(trueOriginFilter.value),
    trueYearFilter.value ? `${trueYearFilter.value}年` : '',
    trueProvinceFilter.value,
    trueModuleFilter.value ? moduleLabel(trueModuleFilter.value) : '',
    trueStatusFilter.value === 'all' ? '' : questionSetPracticeStatusLabel(trueStatusFilter.value)
  ].filter(Boolean);
  return filters.length ? filters.join(' · ') : `全部来源 · ${trueQuestionSets.value.length}套`;
});

onMounted(async () => {
  await load();
  if (route.query.mode === 'self') showCustomSheet.value = true;
  if (route.query.mode === 'tutor' && route.query.start) await startTutorPractice();
  pollTimer = window.setInterval(() => void refreshTasks(), 1200);
});

watch([activeMode, trueOriginFilter, trueYearFilter, trueProvinceFilter, trueModuleFilter, trueStatusFilter], () => { trueQuestionVisibleCount.value = 30; });
onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer);
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const state = await (await practiceCenterFeature()).load(
      String(route.query.dailyPlanItemId || '') || undefined
    );
    cycleName.value = state.cycleName;
    curriculumNodes.value = state.curriculumNodes;
    capabilities.value = state.capabilities;
    tutorPrescription.value = state.prescription;
    initializeCustomSelection();
    generatedSets.value = state.generatedSets;
    trueQuestionSets.value = state.trueQuestionSets; trueQuestionVisibleCount.value = 30;
    restoreTasks(state.activeRuns);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取刷题中心失败';
  } finally {
    loading.value = false;
  }
}
function loadMoreTrueQuestions() { trueQuestionVisibleCount.value = Math.min(trueQuestionSets.value.length, trueQuestionVisibleCount.value + 30); }

function initializeCustomSelection() {
  const requestedModule = normalizeModule(String(route.query.module || ''));
  const requestedPoint = String(route.query.knowledgePoint || '').trim();
  const requestedId = String(route.query.capabilityNodeId || '');
  const requested = capabilities.value.find((item) => item.id === requestedId)
    || capabilities.value.find((item) => requestedPoint && (item.code === requestedPoint || item.name === requestedPoint))
    || capabilities.value.find((item) => requestedModule && item.module === requestedModule)
    || capabilities.value[0];
  if (!requested) return;
  customModule.value = requested.module;
  customQuestionTypeId.value = questionTypeIdFor(requested);
  customCapabilityId.value = requested.id;
}

function restoreTasks(activeRuns: readonly AgentRunView[]) {
  tutorTask.value = activeRuns.find((item) => taskMode(item) === 'tutor') || null;
  selfTask.value = activeRuns.find((item) => taskMode(item) === 'self') || null;
  if (tutorTask.value || selfTask.value) {
    void initializeTutorRuntime().then((runtime) => new StructuredPracticeTaskCenter(runtime).resume());
  }
}

async function startTutorPractice() {
  const prescription = tutorPrescription.value;
  if (!prescription || launching.value || tutorTask.value?.isActive) return;
  launching.value = true;
  error.value = '';
  try {
    const runtime = await initializeTutorRuntime();
    const scopeKey = tutorScope(prescription);
    const difficulty = difficultyFor(prescription.assessmentRole);
    const task = await new StructuredPracticeTaskCenter(runtime).start({
      idempotencyKey: `${scopeKey}:${Date.now()}`,
      scopeKey,
      title: prescription.title,
      detail: prescription.description,
      entryMode: QuestionSetEntryMode.Tutor,
      source: prescription.planItem?.reviewQueueItemId ? 'review' : 'daily_plan',
      capabilityNodeId: prescription.capability.id,
      capabilityCode: prescription.capability.code,
      capabilityName: prescription.capability.name,
      module: prescription.capability.module,
      assessmentRole: prescription.assessmentRole,
      requestedCount: prescription.requestedCount,
      durationMinutes: prescription.planItem?.targetMinutes ?? Math.max(5, Math.ceil(prescription.requestedCount * 1.5)),
      difficultyMin: difficulty[0],
      difficultyMax: difficulty[1],
      goal: `按今日私教计划完成${prescription.capability.name}训练`,
      dailyPlanId: prescription.plan?.plan.id,
      dailyPlanItemId: prescription.planItem?.id,
      reviewQueueItemId: prescription.planItem?.reviewQueueItemId
    });
    trackTask(task, QuestionSetEntryMode.Tutor);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '创建私教练习失败';
  } finally {
    launching.value = false;
  }
}

async function generateCustom() {
  const target = selectedCustomCapability.value;
  if (!target || launching.value || selfTask.value?.isActive) return;
  showCustomSheet.value = false;
  launching.value = true;
  error.value = '';
  try {
    const runtime = await initializeTutorRuntime();
    const scopeKey = `practice:self:${target.id}`;
    const task = await new StructuredPracticeTaskCenter(runtime).start({
      idempotencyKey: `${scopeKey}:${Date.now()}`,
      scopeKey,
      title: `${target.name}自主练习`,
      detail: `${moduleLabel(target.module)} · ${customCount.value}题`,
      entryMode: QuestionSetEntryMode.Self,
      source: 'custom',
      capabilityNodeId: target.id,
      capabilityCode: target.code,
      capabilityName: target.name,
      module: target.module,
      assessmentRole: AssessmentRole.Practice,
      requestedCount: customCount.value,
      durationMinutes: Math.max(5, Math.ceil(customCount.value * 1.5)),
      difficultyMin: 0.35,
      difficultyMax: 0.65,
      goal: `自主练习${target.name}`
    });
    trackTask(task, QuestionSetEntryMode.Self);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '创建自主练习失败';
  } finally {
    launching.value = false;
  }
}

function trackTask(task: AgentRunView, mode: PracticeMode) {
  if (mode === 'tutor') tutorTask.value = task;
  else selfTask.value = task;
  foregroundTaskId.value = task.id;
}

async function refreshTasks() {
  const tracked = [tutorTask.value, selfTask.value]
    .filter((item): item is AgentRunView => Boolean(item?.id && item.isActive));
  if (!tracked.length) return;
  try {
    const runtime = await initializeTutorRuntime();
    const refreshed = (await Promise.all(tracked.map((item) => runtime.getAgentRunViews.findById(item.id))))
      .filter((item): item is AgentRunView => Boolean(item));
    for (const task of refreshed) {
      if (taskMode(task) === 'tutor') tutorTask.value = task;
      else selfTask.value = task;
      if (task.status === 'failed' && task.id === foregroundTaskId.value) error.value = task.detail || '生成练习失败';
    }
    if (refreshed.some((task) => !task.isActive)) {
      generatedSets.value = await (await practiceCenterFeature()).listQuestionSets();
    }
    const completed = refreshed.find((task) => (
      task.id === foregroundTaskId.value
      && task.status === 'completed'
      && task.questionSetId
      && task.learningThreadId
      && navigatedTaskId.value !== task.id
    ));
    if (completed) {
      navigatedTaskId.value = completed.id;
      foregroundTaskId.value = '';
      await router.push({ path: completed.actionRoute || '/vue/practice/objective-session', query: actionQuery(completed) });
    }
  } catch {
    // A later poll or pull-to-refresh restores durable task state.
  }
}
function practiceCenterFeature(): Promise<PracticeCenterFeature> {
  practiceCenterFeaturePromise ??= initializeTutorRuntime().then((runtime) => new PracticeCenterFeature(runtime));
  return practiceCenterFeaturePromise;
}

async function cancelCurrentTask() {
  const task = activeTask.value;
  if (!task) return;
  const runtime = await initializeTutorRuntime();
  await new StructuredPracticeTaskCenter(runtime).cancel(task);
  if (activeMode.value === QuestionSetEntryMode.Tutor) tutorTask.value = null;
  else selfTask.value = null;
  if (foregroundTaskId.value === task.id) foregroundTaskId.value = '';
}

function selectModule(module: string) {
  customModule.value = module;
  customQuestionTypeId.value = curriculumNodes.value.find((item) => (
    item.module === module && item.nodeType === CapabilityNodeType.QuestionType
  ))?.id || '';
  customCapabilityId.value = capabilities.value.find((item) => (
    item.module === module && questionTypeIdFor(item) === customQuestionTypeId.value
  ))?.id || '';
}

function selectQuestionType(questionTypeId: string) {
  customQuestionTypeId.value = questionTypeId;
  customCapabilityId.value = capabilities.value.find((item) => (
    item.module === customModule.value && questionTypeIdFor(item) === questionTypeId
  ))?.id || '';
}

function questionTypeIdFor(node: CapabilityNode): string {
  let current: CapabilityNode | undefined = node;
  while (current?.parentId) {
    const parent = curriculumNodesById.value.get(current.parentId);
    if (!parent) break;
    if (parent.nodeType === CapabilityNodeType.QuestionType) return parent.id;
    current = parent;
  }
  return '';
}

function tutorScope(prescription: TutorPracticePrescription): string {
  const item = prescription.planItem;
  return `practice:tutor:${item?.id || item?.reviewQueueItemId || prescription.capability.id}`;
}

async function openSet(set: QuestionSetLibraryEntry) {
  if (launching.value) return;
  launching.value = true;
  error.value = '';
  try {
    const learningThreadId = set.learningThreadId
      || await (await practiceCenterFeature()).resolveLearningThread(set.id);
    await router.push({
      path: '/vue/practice/objective-session',
      query: { questionSetId: set.id, learningThreadId }
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '打开题组失败';
  } finally {
    launching.value = false;
  }
}

async function startTrueQuestionPractice(mode: 'special' | 'retest') {
  if (launching.value) return;
  launching.value = true;
  error.value = '';
  try {
    const runtime = await initializeTutorRuntime();
    const manifestId = await new TrueQuestionPracticeFeature(runtime).start({
      mode,
      originType: trueOriginFilter.value === 'all' ? undefined : trueOriginFilter.value,
      module: trueModuleFilter.value || undefined,
      examYear: trueYearFilter.value || undefined,
      province: trueProvinceFilter.value || undefined,
      count: truePracticeCount.value
    });
    await router.push({
      path: '/vue/practice/objective-session',
      query: { manifestId }
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '创建真题练习失败';
  } finally {
    launching.value = false;
  }
}

function resetTrueQuestionFilters() {
  trueOriginFilter.value = 'all';
  trueYearFilter.value = 0;
  trueProvinceFilter.value = '';
  trueModuleFilter.value = '';
  trueStatusFilter.value = 'all';
}

function openEssayPractice() {
  void router.push({
    path: '/vue/essay',
    query: {
      source: 'practice-center',
      entryMode: QuestionSetEntryMode.Self,
      open: 'custom'
    }
  });
}

function taskMode(task: AgentRunView): 'tutor' | 'self' {
  if (task.actionParams.mode === QuestionSetEntryMode.Tutor) return QuestionSetEntryMode.Tutor;
  if (task.actionParams.mode === QuestionSetEntryMode.Self) return QuestionSetEntryMode.Self;
  return task.scopeKey?.startsWith('practice:tutor:')
    ? QuestionSetEntryMode.Tutor
    : QuestionSetEntryMode.Self;
}

function normalizeModule(value: string): string {
  if (/判断|图推|逻辑/.test(value)) return 'judgment';
  if (/言语/.test(value)) return 'verbal';
  if (/资料/.test(value)) return 'data_analysis';
  if (/数量|数学/.test(value)) return 'quantity';
  if (/常识/.test(value)) return 'common_sense';
  return moduleDefinitions.some((item) => item.code === value) ? value : '';
}

function moduleLabel(module: string) {
  return practiceModuleLabel(module);
}

function moduleShort(module: string) {
  return moduleLabel(module).slice(0, 1);
}

function setTitle(set: QuestionSetLibraryEntry) {
  return activeMode.value === 'true'
    ? questionSetLibraryTitle(set)
    : `${moduleLabel(set.module)} · ${set.questionCount}题`;
}

function setMeta(set: QuestionSetLibraryEntry) {
  const details = activeMode.value === 'true'
    ? [
        questionOriginLabel(set.originType),
        moduleLabel(set.module),
        `${set.questionCount}题`
      ]
    : [roleLabel(set.assessmentRole)];
  details.push(formatCreatedAt(set.createdAt));
  return details.join(' · ');
}

function roleLabel(role: string) {
  return ({
    teaching: '讲解',
    guided: '引导练习',
    practice: '独立练习',
    retention: '保持复习',
    transfer: '迁移测试',
    anchor: '锚定测试'
  } as Record<string, string>)[role] ?? role;
}

function formatCreatedAt(value: number) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
</script>

<style scoped>
.practice-center { height:100%; min-height:0; overflow:hidden; }
.practice-scroll { display:flex; flex-direction:column; gap:20px; padding-top:12px; }
.section-block { display:flex; flex-direction:column; gap:10px; }
.mode-intro { overflow:hidden; border-radius:var(--radius-card); padding:15px; display:flex; flex-direction:column; gap:13px; background:var(--surface-feature-tutor); box-shadow:var(--shadow-card); }
.mode-intro.mode-self { background:var(--surface-feature-self); }
.mode-intro.mode-true { background:linear-gradient(135deg,rgba(var(--color-brand-rgb),.1),rgba(52,199,89,.09)); }
.mode-intro-copy { min-width:0; }
.mode-intro-copy small,.mode-intro-copy strong { display:block; }
.mode-intro-copy small { color:var(--primary-color); font-size:var(--type-size-micro); font-weight:var(--type-weight-semibold); }
.mode-self .mode-intro-copy small { color:var(--orange-color); }
.mode-intro-copy strong { margin-top:5px; font-size:var(--type-size-body-large); line-height:1.35; }
.mode-intro-copy p { margin:6px 0 0; color:var(--text-secondary-color); font-size:var(--type-size-secondary); line-height:1.5; }
.section-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; }
.section-heading>div { min-width:0; }
.section-heading strong,.section-heading span { display:block; }
.section-heading strong { font-size:var(--type-size-body-large); }
.section-heading span { margin-top:3px; color:var(--text-secondary-color); font-size:var(--type-size-caption); }
.text-action { flex:0 0 auto; border:0; padding:4px; color:var(--primary-color); background:transparent; font:inherit; font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }
.practice-tabs { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:3px; padding:3px; border-radius:999px; background:rgba(var(--color-ink-rgb),.055); }
.practice-tabs button { height:35px; border:0; border-radius:999px; display:flex; align-items:center; justify-content:center; gap:6px; color:rgba(var(--color-brand-rgb),.64); background:transparent; font:inherit; font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }
.practice-tabs button.active { color:var(--primary-color); background:rgba(var(--color-brand-rgb),.11); box-shadow:0 1px 6px rgba(var(--color-brand-rgb),.1); }
.practice-tabs svg { width:15px; height:15px; }
.self-generation-options { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
.generation-card { width:100%; min-width:0; min-height:116px; border:0; border-radius:var(--radius-card); padding:14px; display:grid; grid-template-columns:38px minmax(0,1fr) 16px; gap:11px; align-items:center; color:inherit; background:rgba(var(--color-surface-rgb),.64); box-shadow:var(--shadow-card); text-align:left; font:inherit; }
.generation-card:disabled { opacity:.55; }
.generation-card>i { width:38px; height:38px; display:grid; place-items:center; border-radius:12px; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.11); }
.generation-card.self>i { color:var(--orange-color); background:rgba(255,149,0,.11); }
.generation-card.essay>i { color:var(--green-color); background:rgba(52,199,89,.11); }
.generation-card>i svg { width:18px; height:18px; }
.generation-card>span { min-width:0; }
.generation-card small,.generation-card strong,.generation-card em { display:block; }
.generation-card small { color:var(--primary-color); font-size:var(--type-size-micro); font-weight:var(--type-weight-semibold); }
.generation-card strong { margin-top:4px; font-size:var(--type-size-body); line-height:1.35; }
.generation-card em { margin-top:4px; overflow:hidden; color:var(--text-secondary-color); font-size:var(--type-size-caption); font-style:normal; line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.generation-card>svg { width:16px; height:16px; color:var(--text-secondary-color); }
.page-error { margin:0; color:var(--red-color); font-size:var(--type-size-caption); }
.set-list { overflow:hidden; border-radius:var(--radius-card); background:rgba(var(--color-surface-rgb),.56); box-shadow:var(--shadow-card); }
.set-list button { width:100%; min-height:66px; border:0; border-top:1px solid rgba(var(--color-ink-rgb),.055); padding:10px 12px; display:flex; align-items:center; gap:10px; color:inherit; background:transparent; text-align:left; font:inherit; }
.set-list button:first-child { border-top:0; }
.set-list button>i { width:34px; height:34px; display:grid; place-items:center; flex:0 0 auto; border-radius:11px; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.1); font-size:var(--type-size-caption); font-style:normal; font-weight:var(--type-weight-semibold); }
.set-list button>span { min-width:0; flex:1; }
.set-list strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.set-list strong { font-size:var(--type-size-secondary); }
.set-list em { margin-top:4px; display:flex; align-items:center; gap:7px; overflow:hidden; color:var(--text-secondary-color); font-size:var(--type-size-caption); font-style:normal; }
.set-list em>span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.set-list em>b { flex:0 0 auto; display:inline-flex; align-items:center; gap:3px; color:var(--text-secondary-color); font-size:inherit; font-weight:var(--type-weight-medium); }
.set-list em>b svg { width:12px; height:12px; }
.set-list em>b.status-in_progress { color:var(--orange-color); }
.set-list em>b.status-completed { color:var(--green-color); }
.set-list button>svg { width:16px; height:16px; color:var(--text-secondary-color); }
.custom-sheet,.custom-sheet label { display:flex; flex-direction:column; gap:9px; }
.custom-sheet { gap:15px; }
.custom-sheet label>span { color:var(--text-secondary-color); font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }
.choice-row { display:flex; flex-wrap:wrap; gap:7px; }
.choice-row button,.capability-list button { min-height:34px; border:0; border-radius:999px; padding:0 11px; color:var(--text-secondary-color); background:var(--surface-control); font:inherit; font-size:var(--type-size-caption); }
.choice-row button.active,.capability-list button.active { color:var(--primary-color); background:rgba(var(--color-brand-rgb),.13); font-weight:var(--type-weight-semibold); }
.capability-list { max-height:210px; overflow-y:auto; display:flex; flex-wrap:wrap; gap:7px; padding-right:2px; }
.generate-button { min-height:44px; border:0; border-radius:12px; display:flex; align-items:center; justify-content:center; gap:7px; color:#fff; background:var(--primary-color); font:inherit; font-weight:var(--type-weight-semibold); }
.generate-button:disabled { opacity:.5; }
.filter-footer { position:sticky; bottom:0; display:grid; grid-template-columns:auto minmax(0,1fr); gap:8px; padding-top:4px; background:linear-gradient(180deg,transparent,var(--surface-sheet) 28%); }
.filter-reset,.filter-apply { min-height:44px; border:0; border-radius:12px; padding:0 15px; font:inherit; font-weight:var(--type-weight-semibold); }
.filter-reset { color:var(--text-secondary-color); background:var(--surface-control); }
.filter-apply { color:#fff; background:var(--primary-color); }
.generate-button svg { width:17px; height:17px; }
@media (max-width:430px) {
  .self-generation-options { grid-template-columns:1fr; }
  .self-generation-options .generation-card { min-height:92px; }
}
</style>
