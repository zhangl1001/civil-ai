<template>
  <div class="practice-detail app-page">
    <PageHeader title="行测刷题" :meta="cycleName">
      <template #actions>
        <HeaderMoreMenu title="刷题操作" subtitle="计划、自定义和历史入口">
          <button class="menu-row" type="button" @click="startDailyPlan"><CalendarCheckIcon />每日计划</button>
          <button class="menu-row" type="button" @click="showCustomSheet = true"><SettingsIcon />自定义刷题</button>
          <button class="menu-row" type="button" @click="router.push('/vue/practice')"><LayoutGridIcon />刷题中心</button>
          <button class="menu-row" type="button" @click="router.push('/vue/wrongbook')"><BookMarkedIcon />错题复盘</button>
          <button class="menu-row" type="button" @click="router.push('/vue/knowledge-graph')"><MapIcon />知识地图</button>
        </HeaderMoreMenu>
      </template>
    </PageHeader>

    <PullToRefresh class="practice-detail-scroll" :on-refresh="load">
      <section class="detail-hero">
        <span>{{ targetSourceLabel }}</span>
        <strong>{{ targetCapability?.name || '读取练习方向中' }}</strong>
        <p>{{ targetDescription }}</p>
      </section>

      <section class="action-grid">
        <button class="action-card primary" type="button" :disabled="generating || !targetCapability" @click="startDailyPlan">
          <i><SparklesIcon /></i>
          <strong>{{ generating ? '正在生成...' : '每日计划' }}</strong>
          <span>按备考阶段和薄弱点生成一组题</span>
        </button>
        <button class="action-card" type="button" :disabled="loading || !capabilities.length" @click="showCustomSheet = true">
          <i><SettingsIcon /></i>
          <strong>自定义刷题</strong>
          <span>自己选择考点、题量和训练方向</span>
        </button>
      </section>

      <section class="detail-section">
        <div class="section-title">
          <strong>专项入口</strong>
          <span>按模块进入</span>
        </div>
        <div class="module-grid">
          <button v-for="module in moduleCards" :key="module.code" type="button" @click="openModule(module.code)">
            <span>{{ module.short }}</span>
            <strong>{{ module.name }}</strong>
            <em>{{ module.detail }}</em>
          </button>
        </div>
      </section>

      <section class="detail-section">
        <div class="section-title">
          <strong>最近题组</strong>
          <span>继续练习</span>
        </div>
        <AppStateView v-if="loading" compact state="loading" title="正在读取题组" />
        <AppStateView v-else-if="error" compact state="error" title="刷题详情暂不可用" :description="error" />
        <AppStateView v-else-if="!sets.length" compact title="还没有题组" description="先用每日计划或自定义刷题生成一组题。" />
        <div v-else class="set-list">
          <button v-for="set in sets" :key="set.questionSet.id" type="button" @click="openSet(set.questionSet.id, set.questionSet.learningThreadId)">
            <span>
              <strong>{{ moduleLabel(set.questionSet.module) }} · {{ set.questionSet.questionCount }}题</strong>
              <em>{{ roleLabel(set.questionSet.assessmentRole) }}</em>
            </span>
            <ChevronRightIcon />
          </button>
        </div>
      </section>
    </PullToRefresh>

    <BottomSheet v-model="showCustomSheet" title="自定义刷题" subtitle="按考点主动练一组" variant="filter">
      <div class="custom-practice-sheet">
        <label>
          <span>能力节点</span>
          <div class="capability-options">
            <button
              v-for="item in visibleCapabilities"
              :key="item.id"
              type="button"
              :class="{ active: customCapabilityId === item.id }"
              @click="customCapabilityId = item.id"
            >
              {{ moduleLabel(item.module) }} · {{ item.name }}
            </button>
          </div>
        </label>
        <label>
          <span>题量</span>
          <div class="count-options">
            <button v-for="count in [4, 6, 8, 10]" :key="count" type="button" :class="{ active: customCount === count }" @click="customCount = count">
              {{ count }}题
            </button>
          </div>
        </label>
        <button class="custom-start" type="button" :disabled="generating || !selectedCustomCapability" @click="generateCustom">
          <SparklesIcon />
          {{ generating ? '正在生成...' : '生成题组' }}
        </button>
      </div>
    </BottomSheet>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  BookMarkedIcon,
  CalendarCheckIcon,
  ChevronRightIcon,
  LayoutGridIcon,
  MapIcon,
  SettingsIcon,
  SparklesIcon
} from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
import HeaderMoreMenu from '@/components/layout/HeaderMoreMenu.vue';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import { AppStateView, PullToRefresh } from '@/capabilities/design-system/public';
import {
  createConfiguredProviderGateway,
  initializeTutorRuntime,
  type TutorDatabaseRuntime
} from '@/composition-root/public';
import type { CapabilityNode } from '@/modules/curriculum/public';
import type { CommittedQuestionSetBundle } from '@/modules/content/public';
import { WeakeningPracticeFeature } from './WeakeningPracticeFeature';

const DEFAULT_CAPABILITY_CODE = 'aptitude.judgment.weaken';

const router = useRouter();
const loading = ref(true);
const generating = ref(false);
const error = ref('');
const cycleName = ref('刷题详情');
const sets = ref<readonly CommittedQuestionSetBundle[]>([]);
const targetCapability = ref<CapabilityNode | null>(null);
const targetSource = ref<'mastery' | 'default' | 'fallback'>('default');
const capabilities = ref<readonly CapabilityNode[]>([]);
const showCustomSheet = ref(false);
const customCapabilityId = ref('');
const customCount = ref(6);

const moduleCards = [
  { code: 'judgment', short: '判', name: '判断推理', detail: '图推、定义、类比、逻辑' },
  { code: 'verbal', short: '言', name: '言语理解', detail: '选词、片段、语句表达' },
  { code: 'data_analysis', short: '资', name: '资料分析', detail: '增长、比重、综合材料' },
  { code: 'quantity', short: '数', name: '数量关系', detail: '工程、行程、排列组合' },
  { code: 'common_sense', short: '常', name: '常识判断', detail: '政治、法律、科技人文' }
];

const targetSourceLabel = computed(() => {
  if (targetSource.value === 'mastery') return '当前薄弱主线';
  if (targetSource.value === 'fallback') return '大纲起始能力';
  return '默认能力主线';
});

const targetDescription = computed(() => {
  if (!targetCapability.value) return '系统会根据备考档案和能力画像选择练习方向。';
  const prefix = targetSource.value === 'mastery'
    ? '根据当前掌握度优先训练'
    : '尚无足够练习证据，先从默认能力点建立样本';
  return `${prefix}：${moduleLabel(targetCapability.value.module)} · ${targetCapability.value.name}。`;
});

const selectedCustomCapability = computed(() => (
  capabilities.value.find((item) => item.id === customCapabilityId.value) || null
));

const visibleCapabilities = computed(() => capabilities.value.slice(0, 36));

onMounted(() => {
  void load();
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    cycleName.value = cycle.project.name;
    targetCapability.value = await resolveTargetCapability(runtime);
    capabilities.value = await listPracticeCapabilities(runtime);
    if (!customCapabilityId.value) customCapabilityId.value = targetCapability.value?.id || capabilities.value[0]?.id || '';
    sets.value = await runtime.contentRepository.listQuestionSets(cycle.examCycle.id, 10);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取刷题详情失败';
  } finally {
    loading.value = false;
  }
}

async function startDailyPlan() {
  if (generating.value || !targetCapability.value) return;
  await generateForCapability(targetCapability.value, {
    idempotencyPrefix: 'practice:daily-plan',
    count: 8,
    targetSourceValue: targetSource.value,
    goal: `根据今日计划训练${targetCapability.value.name}`
  });
}

async function generateCustom() {
  if (generating.value || !selectedCustomCapability.value) return;
  showCustomSheet.value = false;
  await generateForCapability(selectedCustomCapability.value, {
    idempotencyPrefix: 'practice:custom',
    count: customCount.value,
    targetSourceValue: 'custom',
    goal: `自定义练习${selectedCustomCapability.value.name}`
  });
}

async function generateForCapability(target: CapabilityNode, options: {
  idempotencyPrefix: string;
  count: number;
  targetSourceValue: string;
  goal: string;
}) {
  generating.value = true;
  error.value = '';
  try {
    const runtime = await initializeTutorRuntime();
    const feature = new WeakeningPracticeFeature(runtime);
    const aggregate = await feature.request({
      idempotencyKey: `${options.idempotencyPrefix}:${target.id}:${Date.now()}`,
      capabilityNodeId: target.id,
      requestedCount: options.count,
      difficultyMin: 0.35,
      difficultyMax: 0.65,
      goal: options.goal,
      constraints: {
        source: 'practice_detail',
        targetSource: options.targetSourceValue,
        capabilityCode: target.code,
        capabilityName: target.name
      }
    });
    const result = await feature.run(aggregate.workflow.id, await createConfiguredProviderGateway());
    if (!result.questionSetId) throw new Error('题组未能发布。');
    await router.push({
      path: '/vue/practice/objective-session',
      query: {
        questionSetId: result.questionSetId,
        learningThreadId: aggregate.spec.learningThreadId
      }
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '生成练习失败';
  } finally {
    generating.value = false;
  }
}

function openModule(moduleCode: string) {
  const first = capabilities.value.find((item) => item.module === moduleCode);
  if (first) customCapabilityId.value = first.id;
  showCustomSheet.value = true;
}

function openSet(questionSetId: string, learningThreadId?: string) {
  if (!learningThreadId) {
    error.value = '该题组缺少学习主线，不能打开。';
    return;
  }
  void router.push({ path: '/vue/practice/objective-session', query: { questionSetId, learningThreadId } });
}

async function resolveTargetCapability(runtime: TutorDatabaseRuntime): Promise<CapabilityNode> {
  const cycle = await runtime.candidateRepository.findCurrentCycle();
  if (!cycle) throw new Error('请先完成备考档案。');
  const curriculum = await runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId);
  if (!curriculum) throw new Error('当前考试大纲未安装。');
  const nodes = curriculum.capabilityNodes.filter((node) => node.status === 'active' && node.subject === 'aptitude');
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const priorityTrack = (await runtime.masteryRepository.listPriorityTracks(cycle.examCycle.id, 1))[0];
  const masteryNode = priorityTrack ? byId.get(priorityTrack.capabilityNodeId) : undefined;
  if (masteryNode) {
    targetSource.value = 'mastery';
    return masteryNode;
  }
  const defaultNode = nodes.find((node) => node.code === DEFAULT_CAPABILITY_CODE);
  if (defaultNode) {
    targetSource.value = 'default';
    return defaultNode;
  }
  const fallback = nodes.find((node) => node.nodeType === 'knowledge_point' || node.nodeType === 'sub_point');
  if (!fallback) throw new Error('当前大纲没有可练习的能力节点。');
  targetSource.value = 'fallback';
  return fallback;
}

async function listPracticeCapabilities(runtime: TutorDatabaseRuntime): Promise<readonly CapabilityNode[]> {
  const cycle = await runtime.candidateRepository.findCurrentCycle();
  if (!cycle) return [];
  const curriculum = await runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId);
  const nodes = curriculum?.capabilityNodes.filter((node) => (
    node.status === 'active'
    && (node.nodeType === 'knowledge_point' || node.nodeType === 'sub_point')
    && node.subject === 'aptitude'
  )) || [];
  return nodes.sort((left, right) => left.sequence - right.sequence);
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

function moduleLabel(module: string) {
  return ({
    judgment: '判断推理',
    verbal: '言语理解',
    data_analysis: '资料分析',
    quantity: '数量关系',
    common_sense: '常识判断',
    essay: '申论'
  } as Record<string, string>)[module] ?? module;
}
</script>

<style scoped>
.practice-detail-scroll {
  display: flex;
  flex-direction: column;
  gap: 15px;
  padding-top: 12px;
}

.detail-hero {
  min-height: 120px;
  padding: 17px 16px;
  border-radius: var(--radius-card);
  background: linear-gradient(135deg, rgba(255,255,255,.76), rgba(232,246,241,.58));
  box-shadow: var(--shadow-card);
}

.detail-hero span {
  color: var(--primary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.detail-hero strong {
  display: block;
  margin-top: 6px;
  font-size: var(--type-size-section-title);
  line-height: var(--type-line-title);
}

.detail-hero p {
  margin: 7px 0 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  line-height: 1.55;
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.action-card,
.module-grid button,
.set-list button {
  border: 0;
  color: inherit;
  background: rgba(var(--color-surface-rgb), .62);
  box-shadow: var(--shadow-card);
  font: inherit;
  text-align: left;
}

.action-card {
  min-height: 116px;
  padding: 13px;
  border-radius: var(--radius-card);
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.action-card:disabled {
  opacity: .62;
}

.action-card i {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .12);
}

.action-card.primary i {
  color: var(--orange-color);
  background: rgba(255,149,0,.12);
}

.action-card svg {
  width: 18px;
  height: 18px;
}

.action-card strong,
.module-grid strong,
.set-list strong {
  color: var(--text-color);
  font-size: var(--type-size-body);
}

.action-card span,
.module-grid em,
.set-list em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  line-height: 1.45;
  font-style: normal;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title strong {
  font-size: var(--type-size-body-large);
}

.section-title span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.module-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.module-grid button {
  min-height: 92px;
  padding: 12px;
  border-radius: var(--radius-card);
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  column-gap: 9px;
  align-items: center;
}

.module-grid span {
  width: 34px;
  height: 34px;
  grid-row: span 2;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .1);
  font-weight: var(--type-weight-semibold);
}

.module-grid strong,
.module-grid em {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.set-list {
  overflow: hidden;
  border-radius: var(--radius-card);
  background: rgba(var(--color-surface-rgb), .56);
  box-shadow: var(--shadow-card);
}

.set-list button {
  width: 100%;
  min-height: 64px;
  padding: 11px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  border-top: 1px solid rgba(var(--color-ink-rgb), .055);
}

.set-list button:first-child {
  border-top: 0;
}

.set-list span {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.set-list svg {
  width: 16px;
  height: 16px;
  color: var(--text-secondary-color);
}

.custom-practice-sheet {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.custom-practice-sheet label {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.custom-practice-sheet label > span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
}

.capability-options,
.count-options {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  max-height: 230px;
  overflow-y: auto;
}

.capability-options button,
.count-options button {
  min-height: 32px;
  border: 0;
  border-radius: var(--radius-pill);
  padding: 0 11px;
  color: var(--text-secondary-color);
  background: var(--surface-control);
  font: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.capability-options button.active,
.count-options button.active {
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .12);
}

.custom-start {
  min-height: 42px;
  border: 0;
  border-radius: var(--radius-control);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: #fff;
  background: var(--primary-color);
  font: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}

.custom-start svg {
  width: 17px;
  height: 17px;
}

.custom-start:disabled {
  opacity: .55;
}
</style>
