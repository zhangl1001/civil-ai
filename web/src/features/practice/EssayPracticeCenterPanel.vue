<template>
  <div class="essay-center-panel">
    <div class="mode-intro mode-essay">
      <PracticeSubjectMark :subject="PracticeSubject.Essay" />
      <div class="mode-intro-copy">
        <small>{{ modeCopy.eyebrow }}</small>
        <strong>{{ modeCopy.title }}</strong>
        <p>{{ modeCopy.description }}</p>
      </div>
      <nav class="practice-tabs" aria-label="申论训练模式">
        <button v-for="item in modes" :key="item.value" type="button" :class="{ active: modelValue === item.value }" @click="$emit('update:modelValue', item.value)">
          <component :is="item.icon" />{{ item.label }}
        </button>
      </nav>
    </div>

    <section class="essay-mainline section-block">
      <div class="section-heading">
        <div>
          <strong>{{ modelValue === 'tutor' ? '今日申论私教动作' : modelValue === 'self' ? '自主练习入口' : '真题练习入口' }}</strong>
          <span>{{ mainlineDescription }}</span>
        </div>
      </div>
      <AiTaskPendingState
        v-if="activeTask"
        :task="activeTask"
        title="AI 正在准备申论训练"
        :description="activeTask.message || activeTask.detail || '题目、讲义和训练目标会在同一任务中准备。'"
        ready-action-label="开始生成"
        retry-action-label="重新生成"
        @retry="retryGeneration"
        @cancel="cancelGeneration"
      />
      <button v-else class="essay-action-card" type="button" :disabled="loading || opening" @click="openPractice">
        <i><component :is="activeModeIcon" /></i>
        <span>
          <small>{{ actionEyebrow }}</small>
          <strong>{{ actionTitle }}</strong>
          <em>{{ actionDescription }}</em>
        </span>
        <ChevronRightIcon />
      </button>
      <p v-if="error" class="essay-error" role="alert">{{ error }}</p>
    </section>

    <section class="section-block essay-sets-section">
      <div class="section-heading">
        <div>
          <strong>{{ modeLabel }}题组</strong>
          <span>{{ sets.length ? `${sets.length}套可继续练习` : '生成后会按入口归类保存' }}</span>
        </div>
        <button type="button" class="text-action" @click="openHistory">历史</button>
      </div>
      <InitialRefreshState v-if="loading" compact label="正在刷新申论题组" />
      <AppStateView v-else-if="!sets.length" compact title="暂无申论题组" :description="emptyDescription" />
      <div v-else class="essay-set-list">
        <button v-for="item in sets" :key="item.key" type="button" @click="openSet(item)">
          <i><FileTextIcon /></i>
          <span>
            <strong>{{ item.question?.title || item.context.topic }}</strong>
            <em>{{ item.context.topic }} · {{ item.context.date }} · {{ item.question ? '可继续作答' : '待生成' }}</em>
          </span>
          <ChevronRightIcon />
        </button>
      </div>
    </section>

    <BottomSheet v-model="showHistory" title="申论历史题组" subtitle="按训练入口归类保存" variant="actions">
      <div class="essay-history">
        <button v-for="item in allStates" :key="item.key" type="button" @click="openSet(item)">
          <span>{{ item.question?.title || item.context.topic }}</span>
            <em>{{ item.classification === 'legacy_unknown' ? '历史未分类' : modeLabelFor(item.context.entryMode) }} · {{ item.context.date }}</em>
        </button>
        <AppStateView v-if="!allStates.length" compact title="暂无历史题组" description="完成一次申论生成后会显示在这里。" />
      </div>
    </BottomSheet>

    <BottomSheet v-model="showCustomSheet" title="自主申论练习" subtitle="先选题型，再进入专属详情页" variant="filter">
      <div class="essay-custom-sheet">
        <section>
          <strong>题型</strong>
          <div class="essay-topic-options">
            <button v-for="topic in essayTopics" :key="topic" type="button" :class="{ active: customTopic === topic }" @click="customTopic = topic">
              {{ topic }}
            </button>
          </div>
        </section>
        <section v-if="customTopic !== '申发论述'">
          <strong>题量</strong>
          <div class="essay-topic-options">
            <button v-for="count in [1, 2, 3]" :key="count" type="button" :class="{ active: customCount === count }" @click="customCount = count">
              {{ count }}题
            </button>
          </div>
        </section>
        <button class="essay-submit" type="button" @click="submitCustom">
          <SparklesIcon />开始生成
        </button>
      </div>
    </BottomSheet>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { BookOpenCheckIcon, ChevronRightIcon, FileTextIcon, LandmarkIcon, SlidersHorizontalIcon, SparklesIcon } from 'lucide-vue-next';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import { AppStateView, InitialRefreshState } from '@/capabilities/design-system/public';
import AiTaskPendingState from '@/components/AiTaskPendingState.vue';
import PracticeSubjectMark from './PracticeSubjectMark.vue';
import { PracticeSubject } from './PracticeSubject';
import type { AgentRunView } from '@/modules/agent/public';
import {
  EssayGenerationCoordinator,
  initializeTutorRuntime,
  type EssayContext,
  type EssayGenerationContext
} from '@/composition-root/public';
import { EssayPracticeCenterFeature, type EssayPracticeMode, type EssayPracticeSet } from './EssayPracticeCenterFeature';
import { essayQuestionSetLocation } from './EssayNavigation';

type Mode = EssayPracticeMode;
const props = defineProps<{ modelValue: Mode }>();
defineEmits<{ 'update:modelValue': [value: Mode] }>();
const router = useRouter();
const feature = ref<EssayPracticeCenterFeature>();
const coordinator = ref<EssayGenerationCoordinator>();
const loading = ref(true);
const opening = ref(false);
const activeTask = ref<AgentRunView>();
const pendingContext = ref<EssayGenerationContext>();
const pendingQuestionCount = ref(1);
const error = ref('');
const showHistory = ref(false);
const showCustomSheet = ref(false);
const customTopic = ref('归纳概括');
const customCount = ref(1);
const allStates = ref<readonly EssayPracticeSet[]>([]);
const essayTopics = ['归纳概括', '综合分析', '提出对策', '贯彻执行', '申发论述'];

const modes = [
  { value: 'tutor' as const, label: '私教学习', icon: SparklesIcon },
  { value: 'self' as const, label: '自主刷题', icon: SlidersHorizontalIcon },
  { value: 'true' as const, label: '真题练习', icon: LandmarkIcon }
];
const modeLabel = computed(() => modes.find((item) => item.value === props.modelValue)?.label || '私教学习');
const modeCopy = computed(() => {
  if (props.modelValue === 'self') return { eyebrow: '自主练习', title: '自己选择申论题型与材料', description: '围绕归纳概括、综合分析、提出对策、贯彻执行和申发论述自主训练。' };
  if (props.modelValue === 'true') return { eyebrow: '真题校准', title: '用真实申论材料校准作答能力', description: '按年份、地区和题型练习真题，批改结果进入同一套能力证据链。' };
  return { eyebrow: '当前私教主线', title: '申论讲解、作答与复盘', description: '私教根据备考阶段、薄弱维度和剩余时间安排材料学习、作答训练与批改。' };
});
const modeStates = computed(() => allStates.value.filter((item) => (
  item.classification !== 'legacy_unknown'
  && normalizedMode(item.context.entryMode) === props.modelValue
)));
const sets = computed(() => modeStates.value);
const mainlineDescription = computed(() => props.modelValue === 'tutor' ? '根据今日计划和能力证据安排' : props.modelValue === 'self' ? '选择题型后生成独立题组' : '导入或整理真实申论材料后练习');
const actionEyebrow = computed(() => props.modelValue === 'tutor' ? '今日教学动作' : props.modelValue === 'self' ? '自主出题' : '真题入口');
const actionTitle = computed(() => props.modelValue === 'tutor' ? '开始今天的申论私教学习' : props.modelValue === 'self' ? '选择申论题型和训练数量' : '导入或选择申论真题');
const actionDescription = computed(() => props.modelValue === 'tutor' ? '讲义、材料、小题和批改围绕同一知识目标组织' : props.modelValue === 'self' ? '生成后题组会留在当前分类，不与私教题组混合' : '真题资产单独归档，作答记录可进入能力分析');
const emptyDescription = computed(() => props.modelValue === 'true' ? '当前还没有申论真题，可从文件导入入口开始建立真题库。' : '点击上方入口创建申论题组，完成后会自动出现在当前分类。');
const activeModeIcon = computed(() => modes.find((item) => item.value === props.modelValue)?.icon || BookOpenCheckIcon);

let taskPollId: number | null = null;

onMounted(async () => {
  await load();
  await restoreActiveTask();
  taskPollId = window.setInterval(() => void refreshTask(), 1000);
});
onBeforeUnmount(() => {
  if (taskPollId !== null) window.clearInterval(taskPollId);
});
watch(() => props.modelValue, async () => {
  activeTask.value = undefined;
  await load();
  await restoreActiveTask();
});

async function load() {
  loading.value = true;
  try {
    feature.value ||= new EssayPracticeCenterFeature(await initializeTutorRuntime());
    coordinator.value ||= new EssayGenerationCoordinator(await initializeTutorRuntime());
    allStates.value = await feature.value.listSets();
  }
  finally { loading.value = false; }
}

async function openPractice() {
  if (props.modelValue === 'self') {
    showCustomSheet.value = true;
    return;
  }
  if (props.modelValue === 'tutor') {
    await startGeneration({ entryMode: 'tutor', topic: '归纳概括', count: 1 });
    return;
  }
  const latestTrueSet = sets.value[0];
  if (latestTrueSet) await openSet(latestTrueSet);
  else error.value = '当前还没有可练习的申论真题。请先完成申论真题导入。';
}

async function submitCustom() {
  showCustomSheet.value = false;
  await startGeneration({
    entryMode: 'self',
    topic: customTopic.value,
    count: customTopic.value === '申发论述' ? 1 : customCount.value
  });
}

async function startGeneration(input: { entryMode: Mode; topic: string; count: number }) {
  if (!coordinator.value || activeTask.value?.isActive) return;
  opening.value = true;
  error.value = '';
  const context: EssayGenerationContext = {
    entryMode: input.entryMode,
    purpose: input.entryMode === 'true' ? 'true_question' : 'practice',
    topic: input.topic,
    type: input.topic === '申发论述' ? 'long' : 'short',
    date: new Date().toISOString().slice(0, 10)
  };
  pendingContext.value = context;
  pendingQuestionCount.value = input.count;
  try {
    activeTask.value = await coordinator.value.start(context, input.count);
    pendingContext.value = contextFromTask(activeTask.value) || context;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '申论生成失败';
  } finally {
    opening.value = false;
  }
}

async function restoreActiveTask() {
  activeTask.value = await coordinator.value?.findActive(props.modelValue);
  if (activeTask.value) {
    pendingContext.value = contextFromTask(activeTask.value);
    pendingQuestionCount.value = typeof activeTask.value.actionParams.questionCount === 'number'
      ? activeTask.value.actionParams.questionCount
      : 1;
  }
}

async function refreshTask() {
  const taskId = activeTask.value?.id;
  if (!taskId || !coordinator.value) return;
  const task = await coordinator.value.find(String(taskId));
  if (!task) return;
  activeTask.value = task;
  if (task.status === 'completed') {
    await load();
    const context = pendingContext.value || contextFromTask(task);
    activeTask.value = undefined;
    if (context) await openLatestSet(context);
  }
}

async function cancelGeneration() {
  const taskId = activeTask.value?.id;
  if (!taskId || !coordinator.value) return;
  activeTask.value = await coordinator.value.cancel(String(taskId));
}

async function retryGeneration() {
  const context = pendingContext.value;
  if (!context) {
    activeTask.value = undefined;
    showCustomSheet.value = true;
    return;
  }
  activeTask.value = undefined;
  await startGeneration({
    entryMode: normalizedMode(context.entryMode),
    topic: context.topic,
    count: context.topic === '申发论述' ? 1 : pendingQuestionCount.value
  });
}

function openHistory() { showHistory.value = true; }
async function openSet(item: EssayPracticeSet) {
  showHistory.value = false;
  await router.push(essayQuestionSetLocation({
    questionSetId: item.context.questionSetId || item.key,
    entryMode: normalizedMode(item.context.entryMode),
    date: item.context.date,
    topic: item.context.topic,
    type: item.context.type,
    purpose: item.context.purpose
  }));
}
async function openLatestSet(context: EssayGenerationContext) {
  const item = allStates.value.find((candidate) => (
    context.questionSetId
      ? candidate.context.questionSetId === context.questionSetId
      : candidate.context.date === context.date && candidate.context.topic === context.topic && normalizedMode(candidate.context.entryMode) === context.entryMode
  ));
  if (item) {
    await openSet(item);
  } else {
    error.value = '任务已完成，但题组还在整理，请稍后刷新申论题组。';
  }
}
function contextFromTask(task: AgentRunView): EssayContext | undefined {
  const mode = task.actionParams.entryMode || task.actionParams.mode;
  const topic = task.actionParams.topic;
  const date = task.actionParams.date;
  const questionSetId = task.actionParams.questionSetId;
  const type = task.actionParams.type;
  const purpose = task.actionParams.purpose;
  if (
    (mode !== 'tutor' && mode !== 'self' && mode !== 'true')
    || typeof topic !== 'string'
    || typeof date !== 'string'
    || typeof questionSetId !== 'string'
    || !questionSetId
  ) return undefined;
  return {
    questionSetId,
    entryMode: mode,
    topic,
    date,
    type: type === 'long' ? 'long' : 'short',
    purpose: purpose === 'mock' || purpose === 'true_question' ? purpose : 'practice'
  };
}
function normalizedMode(value?: EssayPracticeMode): Mode { return value === 'tutor' || value === 'true' ? value : 'self'; }
function modeLabelFor(value?: EssayPracticeMode): string { return modes.find((item) => item.value === normalizedMode(value))?.label || '自主刷题'; }
</script>

<style scoped>
.essay-center-panel { display:flex; flex-direction:column; gap:14px; }
.mode-intro { position:relative; display:flex; flex-direction:column; gap:16px; padding:18px; border-radius:var(--radius-card); background:rgba(var(--color-brand-rgb),.11); }
.mode-intro-copy { display:flex; flex-direction:column; gap:6px; min-width:0; padding-right:38px; }
.mode-intro-copy small { color:var(--primary-color); font-weight:var(--type-weight-semibold); }
.mode-intro-copy strong { font-size:var(--type-size-title); line-height:1.25; }
.mode-intro-copy p { margin:0; color:var(--text-secondary-color); line-height:1.5; }
.practice-tabs { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; padding:4px; border-radius:999px; background:rgba(var(--color-ink-rgb),.05); }
.practice-tabs button { min-width:0; min-height:38px; display:flex; align-items:center; justify-content:center; gap:5px; border:0; border-radius:999px; color:var(--primary-color); background:transparent; font:inherit; font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); white-space:nowrap; }
.practice-tabs button.active { background:rgba(var(--color-surface-rgb),.85); box-shadow:0 3px 10px rgba(var(--color-ink-rgb),.08); }
.practice-tabs svg { width:16px; height:16px; flex:0 0 auto; }
.section-block { display:flex; flex-direction:column; gap:12px; }
.section-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:10px; }
.section-heading>div { min-width:0; display:flex; flex-direction:column; gap:4px; }
.section-heading strong { font-size:var(--type-size-title); }
.section-heading span { color:var(--text-secondary-color); font-size:var(--type-size-caption); }
.text-action { border:0; background:transparent; color:var(--primary-color); font:inherit; font-size:var(--type-size-caption); }
.essay-action-card,.essay-set-list button,.essay-history button { width:100%; display:flex; align-items:center; gap:12px; border:0; border-radius:var(--radius-card); color:inherit; background:rgba(var(--color-surface-rgb),.72); text-align:left; font:inherit; }
.essay-action-card { padding:16px; box-shadow:0 8px 24px rgba(var(--color-ink-rgb),.05); }
.essay-action-card:disabled { opacity:.65; }
.essay-action-card>i,.essay-set-list button>i { width:42px; height:42px; flex:0 0 auto; display:grid; place-items:center; border-radius:14px; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.12); }
.essay-action-card svg { width:20px; height:20px; }
.essay-action-card>span,.essay-set-list button>span { min-width:0; flex:1; display:flex; flex-direction:column; gap:4px; }
.essay-action-card small { color:var(--primary-color); font-size:var(--type-size-micro); font-weight:var(--type-weight-semibold); }
.essay-action-card strong,.essay-set-list strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--type-size-body); }
.essay-action-card em,.essay-set-list em,.essay-history em { color:var(--text-secondary-color); font-size:var(--type-size-caption); font-style:normal; line-height:1.45; }
.essay-action-card>svg,.essay-set-list button>svg { color:var(--text-secondary-color); flex:0 0 auto; }
.essay-error { margin:0; color:var(--danger-color, #c63737); font-size:var(--type-size-caption); line-height:1.5; }
.essay-set-list { display:flex; flex-direction:column; overflow:hidden; border-radius:var(--radius-card); background:rgba(var(--color-surface-rgb),.62); }
.essay-set-list button { padding:13px 14px; border-radius:0; border-bottom:1px solid rgba(var(--color-ink-rgb),.06); }
.essay-set-list button:last-child { border-bottom:0; }
.essay-history { display:flex; flex-direction:column; gap:8px; }
.essay-history button { flex-direction:column; align-items:flex-start; padding:12px 14px; }
.essay-history span { font-weight:var(--type-weight-semibold); }
.essay-custom-sheet { display:flex; flex-direction:column; gap:18px; }
.essay-custom-sheet section { display:flex; flex-direction:column; gap:8px; }
.essay-custom-sheet section>strong { color:var(--text-secondary-color); font-size:var(--type-size-caption); }
.essay-topic-options { display:flex; flex-wrap:wrap; gap:8px; }
.essay-topic-options button { min-height:36px; padding:0 12px; border:0; border-radius:999px; color:var(--text-secondary-color); background:var(--surface-control); font:inherit; font-size:var(--type-size-caption); }
.essay-topic-options button.active { color:var(--primary-color); background:rgba(var(--color-brand-rgb),.14); font-weight:var(--type-weight-semibold); }
.essay-submit { min-height:44px; display:flex; align-items:center; justify-content:center; gap:7px; border:0; border-radius:12px; color:#fff; background:var(--primary-color); font:inherit; font-weight:var(--type-weight-semibold); }
.essay-submit svg { width:17px; height:17px; }
</style>
