<template>
  <div class="tutor-practice app-page">
    <PageHeader title="刷题中心" :meta="cycleName" />
    <PullToRefresh class="tutor-practice-scroll" :on-refresh="load">
      <section class="practice-intro">
        <span>{{ targetSourceLabel }}</span>
        <strong>{{ targetCapability?.name || '正在读取能力主线' }}</strong>
        <p>{{ targetDescription }}</p>
        <div class="practice-actions">
          <button type="button" :disabled="generating || !targetCapability" @click="generate">
            <SparklesIcon />
            {{ generating ? '正在生成...' : '开始针对性练习' }}
          </button>
          <button class="secondary-action" type="button" :disabled="loading || !capabilities.length" @click="showCustomSheet = true">
            自定义刷题
          </button>
        </div>
        <em v-if="error">{{ error }}</em>
      </section>

      <section class="practice-section">
        <h2>最近题组</h2>
        <AppStateView v-if="loading" compact state="loading" title="正在读取题组" />
        <AppStateView v-else-if="!sets.length" compact title="还没有新题组" description="可以先开始一次针对性练习，题组会自动沉淀在这里。" />
        <button
          v-else
          v-for="set in sets"
          :key="set.questionSet.id"
          class="set-row"
          type="button"
          @click="open(set.questionSet.id, set.questionSet.learningThreadId)"
        >
          <span>
            <strong>{{ moduleLabel(set.questionSet.module) }} · {{ set.questionSet.questionCount }}题</strong>
            <em>{{ roleLabel(set.questionSet.assessmentRole) }}</em>
          </span>
          <ChevronRightIcon />
        </button>
      </section>
    </PullToRefresh>

    <BottomSheet v-model="showCustomSheet" title="自定义刷题" subtitle="碎片时间主动练一组" variant="filter">
      <div class="custom-practice-sheet">
        <label>
          <span>能力节点</span>
          <div class="capability-options">
            <button
              v-for="item in capabilities"
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
          <div class="count-options">
            <button v-for="count in [4, 6, 8, 10]" :key="count" type="button" :class="{ active: customCount === count }" @click="customCount = count">
              {{ count }}题
            </button>
          </div>
        </label>
        <button class="custom-start" type="button" :disabled="generating || !selectedCustomCapability" @click="generateCustom">
          <SparklesIcon />
          {{ generating ? '正在生成...' : '生成自定义题组' }}
        </button>
      </div>
    </BottomSheet>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronRightIcon, SparklesIcon } from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
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
const cycleName = ref('刷题中心');
const sets = ref<readonly CommittedQuestionSetBundle[]>([]);
const targetCapability = ref<CapabilityNode | null>(null);
const targetSource = ref<'mastery' | 'default' | 'fallback'>('default');
const capabilities = ref<readonly CapabilityNode[]>([]);
const showCustomSheet = ref(false);
const customCapabilityId = ref('');
const customCount = ref(6);

const targetSourceLabel = computed(() => {
  if (targetSource.value === 'mastery') return '当前薄弱主线';
  if (targetSource.value === 'fallback') return '大纲起始能力';
  return '默认能力主线';
});

const targetDescription = computed(() => {
  if (!targetCapability.value) return '系统会根据备考档案和能力画像选择练习方向。';
  const prefix = targetSource.value === 'mastery'
    ? '根据当前掌握度优先训练'
    : '尚无足够练习证据，先从默认能力起点建立样本';
  return `${prefix}：${moduleLabel(targetCapability.value.module)} · ${targetCapability.value.name}。讲义、题目、错因和复习会写入同一条学习主线。`;
});
const selectedCustomCapability = computed(() => (
  capabilities.value.find((item) => item.id === customCapabilityId.value) || null
));

onMounted(() => {
  void load();
});

async function load() {
  loading.value = true;
  try {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    cycleName.value = cycle.project.name;
    targetCapability.value = await resolveTargetCapability(runtime);
    capabilities.value = await listPracticeCapabilities(runtime);
    if (!customCapabilityId.value) customCapabilityId.value = targetCapability.value?.id || capabilities.value[0]?.id || '';
    sets.value = await runtime.contentRepository.listQuestionSets(cycle.examCycle.id, 12);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取题组失败';
  } finally {
    loading.value = false;
  }
}

async function generateCustom() {
  if (generating.value || !selectedCustomCapability.value) return;
  showCustomSheet.value = false;
  await generateForCapability(selectedCustomCapability.value, {
    idempotencyPrefix: 'practice:custom',
    count: customCount.value,
    targetSourceValue: 'custom',
    goal: `利用碎片时间练习${selectedCustomCapability.value.name}`
  });
}

async function generate() {
  if (generating.value || !targetCapability.value) return;
  await generateForCapability(targetCapability.value, {
    idempotencyPrefix: 'practice:targeted',
    count: 8,
    targetSourceValue: targetSource.value,
    goal: `针对${targetCapability.value.name}完成独立练习`
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
        source: 'practice_center',
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

async function resolveTargetCapability(runtime: TutorDatabaseRuntime): Promise<CapabilityNode> {
  const cycle = await runtime.candidateRepository.findCurrentCycle();
  if (!cycle) throw new Error('请先完成备考档案。');
  const curriculum = await runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId);
  if (!curriculum) throw new Error('当前考试大纲未安装。');
  const nodes = curriculum.capabilityNodes.filter((node) => node.status === 'active');
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
  return nodes.sort((left, right) => left.sequence - right.sequence).slice(0, 24);
}

function open(questionSetId: string, learningThreadId?: string) {
  if (!learningThreadId) {
    error.value = '该题组缺少学习主线，不能作为新私教练习打开。';
    return;
  }
  void router.push({ path: '/vue/practice/objective-session', query: { questionSetId, learningThreadId } });
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
.tutor-practice-scroll {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-top: 12px;
}

.practice-intro {
  padding: 18px 16px;
  border-radius: 8px;
  background: rgba(var(--color-brand-rgb), .065);
}

.practice-intro span,
.practice-intro p,
.practice-intro em {
  display: block;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
}

.practice-intro strong {
  display: block;
  margin-top: 5px;
  font-size: var(--type-size-title-small);
}

.practice-intro p {
  margin: 7px 0 14px;
  line-height: 1.5;
}

.practice-actions {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, .95fr);
  gap: 8px;
}

.practice-intro button {
  width: 100%;
  min-height: 40px;
  border: 0;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 10px;
  background: var(--primary-color);
  color: #fff;
  font: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
  white-space: nowrap;
}

.practice-intro .secondary-action {
  background: rgba(var(--color-brand-rgb), .1);
  color: var(--primary-color);
}

.practice-intro button:disabled {
  opacity: .6;
}

.practice-intro button svg {
  width: 16px;
  height: 16px;
}

.practice-intro em {
  margin-top: 10px;
  color: var(--red-color);
  font-style: normal;
}

@media (max-width: 360px) {
  .practice-actions {
    grid-template-columns: 1fr;
  }
}

.practice-section h2 {
  margin: 0 0 8px;
  font-size: var(--type-size-body-large);
}

.set-row {
  width: 100%;
  min-height: 62px;
  border: 0;
  border-top: 1px solid rgba(var(--color-ink-rgb), .06);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 13px;
  background: transparent;
  color: inherit;
  text-align: left;
}

.set-row span {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.set-row strong {
  font-size: var(--type-size-body);
}

.set-row em,
.empty {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-style: normal;
}

.set-row > svg {
  width: 16px;
  color: var(--text-secondary-color);
}

.empty {
  padding: 22px 0;
  text-align: center;
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
  font-weight: var(--type-weight-semibold);
}

.capability-options,
.count-options {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.capability-options button,
.count-options button {
  min-height: 32px;
  border: 0;
  border-radius: 999px;
  padding: 0 11px;
  background: var(--surface-control);
  color: var(--text-secondary-color);
  font: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.capability-options button.active,
.count-options button.active {
  background: rgba(var(--color-brand-rgb), .12);
  color: var(--primary-color);
}

.custom-start {
  min-height: 42px;
  border: 0;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  background: var(--primary-color);
  color: #fff;
  font: inherit;
  font-weight: var(--type-weight-semibold);
}

.custom-start svg {
  width: 16px;
  height: 16px;
}
</style>
