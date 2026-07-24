<template>
  <div class="practice-page app-page">
    <div v-if="actionMessage" class="practice-notice" :class="{ error: actionMessageType === 'error' }">
      {{ actionMessage }}
    </div>
    <PageHeader class="practice-header">
      <template #title>
        <div v-if="isCenterMode" class="app-title-row compact-title">
          <span class="app-title-icon"><Edit3Icon /></span>
          <div class="app-title-copy">
            <h3>刷题中心</h3>
            <span>{{ centerMeta }}</span>
          </div>
        </div>
        <div v-else class="session-title">
          <button class="session-module-trigger" type="button" @click.stop="showHeaderModuleMenu = !showHeaderModuleMenu">
            <strong>{{ currentSessionModule || '今日练习' }}</strong>
            <ChevronDownIcon :class="{ open: showHeaderModuleMenu }" />
          </button>
          <span>{{ sessionMetaText }}</span>
          <Transition name="module-pop">
            <div v-if="showHeaderModuleMenu" class="header-module-popover" @click.stop>
              <button
                v-for="module in moduleOptions"
                :key="module"
                type="button"
                :class="{ active: currentSessionModule === module }"
                @click="switchSessionModule(module)"
              >
                {{ module }}
              </button>
            </div>
          </Transition>
        </div>
      </template>
      <template v-if="!isCenterMode" #actions>
        <HeaderMoreMenu title="做题操作" subtitle="生成、加练和历史记录">
          <button class="menu-row" type="button" @click="generatePractice()"><SparklesIcon />重新生成</button>
          <button class="menu-row" type="button" @click="showHistorySheet = true"><HistoryIcon />历史记录</button>
          <button class="menu-row" type="button" @click="extraPractice"><PlusCircleIcon />加练一组</button>
          <button class="menu-row" type="button" @click="showModuleSheet = true"><SettingsIcon />自定义出题</button>
          <button class="menu-row danger" type="button" @click="discardCurrentSession"><Trash2Icon />丢弃本组</button>
          <button class="menu-row" type="button" @click="showCenter"><LayoutGridIcon />返回中心</button>
        </HeaderMoreMenu>
      </template>
    </PageHeader>

    <div v-if="store.isLoading" class="loading">加载题目中...</div>

    <main v-else-if="isCenterMode" class="practice-center app-page-scroll">
      <section class="center-hero app-card">
        <div>
          <span>刷题学习中心</span>
          <strong>练习、讲义、错题和模考都从这里进入</strong>
          <em>{{ centerMeta }}</em>
        </div>
        <button type="button" @click="startDailyPlan"><SparklesIcon />每日计划</button>
      </section>

      <section class="center-status">
        <article class="app-card">
          <strong>{{ totalRecentQuestions }}</strong>
          <span>近期题量</span>
        </article>
        <article class="app-card">
          <strong>{{ averageRecentAccuracy }}</strong>
          <span>平均正确率</span>
        </article>
        <article class="app-card">
          <strong>{{ store.recentSessions.length }}</strong>
          <span>最近练习</span>
        </article>
      </section>

      <section id="practice-start" class="primary-learning-grid">
        <button type="button" class="learning-card app-card blue" @click="startDailyPlan">
          <span><ZapIcon /></span>
          <strong>智能推题</strong>
          <em>按当前阶段和薄弱项生成练习</em>
        </button>
        <button type="button" class="learning-card app-card green" @click="router.push('/vue/essay')">
          <span><PenToolIcon /></span>
          <strong>申论写作</strong>
          <em>材料阅读、作答和 AI 批改</em>
        </button>
      </section>

      <section id="practice-tools" class="tool-grid">
        <button v-for="tool in learningTools" :key="tool.title" type="button" class="tool-card app-card" @click="openLearningTool(tool)">
          <span :class="['tool-icon', tool.tone]"><component :is="tool.icon" /></span>
          <strong>{{ tool.title }}</strong>
          <em>{{ tool.sub }}</em>
        </button>
      </section>

      <section id="practice-modules" class="section-block">
        <div class="section-title">
          <strong>专项练习</strong>
          <span>选择模块后进入刷题页</span>
        </div>
      <section class="module-center-grid">
        <button v-for="module in moduleCards" :key="module.name" type="button" class="module-center-card app-card" @click="startModule(module.name)">
          <span>{{ module.short }}</span>
          <strong>{{ module.name }}</strong>
          <em>{{ module.meta }}</em>
        </button>
      </section>
      </section>

      <section v-if="store.recentSessions.length" id="practice-recent" class="recent-panel center-recent">
        <div class="section-title">
          <strong>近期练习</strong>
          <span>最近 7 条</span>
        </div>
        <article v-for="session in store.recentSessions" :key="session.id" class="recent-row">
          <div>
            <strong>{{ session.module || '专项练习' }}</strong>
            <span>{{ session.date }} · {{ modeText(session.mode) }}</span>
          </div>
          <em>{{ session.correctCount }}/{{ session.questionCount }} · {{ session.accuracy }}%</em>
        </article>
      </section>
    </main>

    <div v-else-if="store.currentQuestion" class="session-shell">
      <div class="mode-tabs">
        <button type="button" :class="{ active: sessionMode === 'lecture' }" @click="sessionMode = 'lecture'">讲义</button>
        <button type="button" :class="{ active: sessionMode === 'practice' }" @click="sessionMode = 'practice'">刷题</button>
      </div>
      <main
        class="question-area app-page-scroll"
        @touchstart.passive="handleQuestionTouchStart"
        @touchmove.passive="handleQuestionTouchMove"
        @touchend="handleQuestionTouchEnd"
      >
        <section v-if="sessionMode === 'lecture'" class="lecture-card app-card">
          <span>{{ store.module || '专项练习' }}</span>
          <h4>{{ lectureContent.title }}</h4>
          <p>{{ lectureSummary }}</p>
          <div class="lecture-points">
            <strong>核心方法</strong>
            <em v-for="item in lectureContent.methods" :key="item">{{ item }}</em>
          </div>
          <div class="lecture-points">
            <strong>常见陷阱</strong>
            <em v-for="item in lectureContent.traps" :key="item">{{ item }}</em>
          </div>
          <div class="lecture-points">
            <strong>做题步骤</strong>
            <em v-for="item in lectureContent.steps" :key="item">{{ item }}</em>
          </div>
          <div class="lecture-points">
            <strong>复盘任务</strong>
            <em v-for="item in lectureContent.reviewFocus" :key="item">{{ item }}</em>
          </div>
        </section>
        <QuestionDisplay
          v-else
          :question="store.currentQuestion"
          :question-number="store.currentQuestionIndex + 1"
          :user-answer="store.userAnswers[store.currentQuestionIndex]"
          :is-submitted="isSubmitted"
          :default-explanation-open="store.isFinished"
          :show-ai-analysis="store.isFinished"
          :grading-detail="currentAnswerDetail"
          :difficulty="store.context?.difficulty"
          :question-type="store.context?.questionType"
          @select="handleSelect"
          @ask-ai="askAIAboutQuestion(store.currentQuestionIndex)"
        />
      </main>
    </div>

    <AiTaskPendingState
      v-else
      :task="currentGenerationTask"
      :title="emptyQuestionTitle"
      :description="emptyQuestionText"
      :disabled="isGeneratingPractice"
      hide-primary-action
      ready-action-label="每日计划"
      retry-action-label="重新生成"
      @start="generatePractice"
      @retry="generatePractice"
      @cancel="cancelGenerationTask"
    >
      <button class="pending-choice" type="button" :disabled="isGeneratingPractice" @click="startDailyPlan">
        <SparklesIcon />
        每日计划
      </button>
      <button class="pending-choice" type="button" @click="showModuleSheet = true">
        <SparklesIcon />
        自定义生题
      </button>
    </AiTaskPendingState>

    <div v-if="showPracticeFooter" class="footer app-page-footer">
      <button
        class="nav-btn"
        type="button"
        :disabled="store.currentQuestionIndex === 0"
        @click="prevQuestion"
      >
        上一题
      </button>
      <button
        class="sheet-btn"
        type="button"
        @click="showAnswerSheet = true"
      >
        <span>{{ store.currentQuestionIndex + 1 }}</span>
        答题卡
      </button>
      <button
        @click="nextQuestionByNavigation"
        class="nav-btn next-nav"
        :disabled="!store.currentQuestion || (store.isFinished && isLastQuestion)"
      >
        {{ nextButtonText }}
      </button>
    </div>

    <BottomSheet v-model="showAnswerSheet" title="答题卡" :subtitle="`${answeredCount}/${store.questions.length}`" variant="actions">
      <div class="sheet-summary">
        <span>未答 <strong>{{ unansweredCount }}</strong></span>
        <span>已答 <strong>{{ answeredCount }}</strong></span>
        <span>正确 <strong>{{ submittedCorrectCount }}</strong></span>
        <span>错误 <strong>{{ submittedWrongCount }}</strong></span>
      </div>
      <div class="sheet-legend">
        <span><i class="unanswered"></i>未答</span>
        <span><i class="answered"></i>已选</span>
        <span><i class="correct"></i>正确</span>
        <span><i class="wrong"></i>错误</span>
      </div>
      <div class="sheet-grid">
        <button
          v-for="(_, index) in store.questions"
          :key="index"
          type="button"
          :class="sheetClass(index)"
          @click="jumpTo(index); showAnswerSheet = false"
        >
          {{ index + 1 }}
        </button>
      </div>
    </BottomSheet>

    <BottomSheet v-model="showModuleSheet" title="自定义出题" :subtitle="`${selectedQuestionCount} 题`" variant="filter">
      <div class="module-sheet">
        <div class="filter-block">
          <span>选择模块</span>
          <div class="module-grid">
            <button
              v-for="module in moduleOptions"
              :key="module"
              type="button"
              :class="{ active: selectedModule === module }"
              @click="selectCustomModule(module)"
            >
              {{ module }}
            </button>
          </div>
        </div>
        <div class="filter-block">
          <span>知识点 <em>可多选</em></span>
          <div class="topic-groups">
            <section v-for="group in selectedKnowledgeGroups" :key="group.name">
              <strong>{{ group.name }}</strong>
              <div>
                <button
                  v-for="topic in group.points"
                  :key="topic"
                  type="button"
                  :class="{ active: selectedKnowledgePoints.includes(topic) }"
                  @click="toggleKnowledgePoint(topic)"
                >
                  {{ topic }}
                </button>
              </div>
            </section>
          </div>
        </div>
        <div class="filter-block">
          <span>题目数量</span>
          <div class="option-row">
            <button v-for="count in questionCountOptions" :key="count" type="button" :class="{ active: selectedQuestionCount === count }" @click="selectedQuestionCount = count">{{ count }}</button>
          </div>
        </div>
        <div class="filter-block">
          <span>难度</span>
          <div class="option-row">
            <button v-for="item in difficultyOptions" :key="item" type="button" :class="{ active: selectedDifficulty === item }" @click="selectedDifficulty = item">{{ item }}</button>
          </div>
        </div>
        <div class="filter-block">
          <span>题型</span>
          <div class="option-row">
            <button v-for="item in questionTypeOptions" :key="item" type="button" :class="{ active: selectedQuestionType === item }" @click="selectedQuestionType = item">{{ item }}</button>
          </div>
        </div>
        <div class="filter-block">
          <span>题源风格</span>
          <div class="option-row">
            <button v-for="item in sourceStyleOptions" :key="item" type="button" :class="{ active: selectedSourceStyle === item }" @click="selectedSourceStyle = item">{{ item }}</button>
          </div>
        </div>
        <div class="filter-block two-column">
          <label class="count-field">
            <span>限时</span>
            <input v-model.number="selectedTimeLimitMinutes" type="number" min="0" max="180" step="5" />
          </label>
          <div class="count-field purpose-field">
            <span>目标</span>
            <div class="purpose-options">
              <button
                v-for="item in practicePurposeOptions"
                :key="item"
                type="button"
                :class="{ active: selectedPracticePurpose === item }"
                @click="selectedPracticePurpose = item"
              >
                {{ item }}
              </button>
            </div>
          </div>
        </div>
        <button class="action-btn" type="button" :disabled="isGeneratingPractice" @click="startCustomPractice">
          <SparklesIcon />
          {{ isGeneratingPractice ? '正在创建任务' : '生成练习' }}
        </button>
      </div>
    </BottomSheet>

    <BottomSheet v-model="showHistorySheet" :title="`历史练习 · ${store.module || selectedModule}`" subtitle="按生成时间选择题组" variant="actions">
      <div v-if="historyGroups.length" class="history-date-list">
        <section v-for="group in historyGroups" :key="group.month">
          <strong>{{ group.month }}</strong>
          <button v-for="item in group.items" :key="item.id" type="button" class="history-sheet-row" @click="openHistoryItem(item)">
            <span>{{ historyTitleText(item) }}</span>
            <strong :class="{ pending: item.kind === 'generated' }">{{ historyStateText(item) }}</strong>
            <em>{{ historyDetailText(item) }}</em>
            <small v-if="isCurrentHistoryItem(item)">当前</small>
          </button>
        </section>
      </div>
      <div v-else class="sheet-empty">暂无历史练习</div>
    </BottomSheet>

    <ConfirmDialog
      v-model="showSubmitConfirm"
      title="提交批改"
      :description="submitConfirmText"
      confirm-text="确认提交"
      cancel-text="继续作答"
      @confirm="confirmSubmitWithBlank"
    />

  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  BarChart3Icon,
  BookOpenIcon,
  ChevronDownIcon,
  Edit3Icon,
  FileTextIcon,
  FlameIcon,
  HistoryIcon,
  MapIcon,
  LayoutGridIcon,
  NewspaperIcon,
  PenToolIcon,
  PlusCircleIcon,
  RotateCcwIcon,
  SettingsIcon,
  SparklesIcon,
  Trash2Icon,
  ZapIcon
} from 'lucide-vue-next';
import { usePracticeStore } from '@/stores/practice';
import { useAIChatStore } from '@/stores/aiChat';
import AiTaskPendingState from '@/components/AiTaskPendingState.vue';
import QuestionDisplay from '@/components/QuestionDisplay.vue';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import ConfirmDialog from '@/components/layout/ConfirmDialog.vue';
import HeaderMoreMenu from '@/components/layout/HeaderMoreMenu.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import { useTasksStore } from '@/stores/tasks';
import { TASK_CHANGED_EVENT, taskStore } from '@/tasks/TaskStore';
import type { AnswerRecord, PracticeMode, PracticeSession } from '@/domain/practice';
import type { LocalTask } from '@/domain/task';
import { practiceFlowService } from '@/services/PracticeFlowService';
import { practiceSessionRepository } from '@/services/PracticeSessionRepository';
import { DEFAULT_KNOWLEDGE_TREE, XC_MODULES } from '@/services/KnowledgeDefaults';
import type { PracticeDraftSnapshot } from '@/stores/practice';
import { questionRepository, type GeneratedQuestionBatch } from '@/services/QuestionRepository';
import { generationTaskService } from '@/services/GenerationTaskService';

type PracticeHistoryItem =
  | (PracticeSession & { kind: 'session' })
  | (GeneratedQuestionBatch & { kind: 'generated'; date: string; mode: PracticeMode; accuracy: number; correctCount: number });

const store = usePracticeStore();
const aiChat = useAIChatStore();
const tasksStore = useTasksStore();
const router = useRouter();
const route = useRoute();
const submittedIndexes = ref<Record<string, true>>({});
const reloadedSourceRef = ref('');
const elapsedMs = ref(0);
const showAnswerSheet = ref(false);
const showModuleSheet = ref(false);
const showHistorySheet = ref(false);
const showSubmitConfirm = ref(false);
const showHeaderModuleMenu = ref(false);
const isGeneratingPractice = ref(false);
const actionMessage = ref('');
const actionMessageType = ref<'info' | 'error'>('info');
const isCenterMode = ref(false);
const sessionMode = ref<'lecture' | 'practice'>('practice');
const moduleOptions = XC_MODULES;
const selectedModule = ref('资料分析');
const selectedQuestionCount = ref(10);
const selectedKnowledgePoints = ref<string[]>([]);
const selectedDifficulty = ref('标准');
const selectedQuestionType = ref('单选题');
const selectedSourceStyle = ref('真题风格模拟');
const selectedPracticePurpose = ref('专项巩固');
const selectedTimeLimitMinutes = ref(0);
const historySessions = ref<PracticeSession[]>([]);
const generatedHistoryBatches = ref<GeneratedQuestionBatch[]>([]);
const answerDetails = ref<Record<string, AnswerRecord>>({});
let timerId: number | null = null;
let draftTimerId: number | null = null;
let autoAdvanceTimerId: number | null = null;
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let questionSwiping = false;

const questionCountOptions = [5, 10, 15, 20, 25];
const difficultyOptions = ['基础', '标准', '提高', '冲刺', '错题同难度+变式'];
const questionTypeOptions = ['单选题', '易错题', '材料题', '计算题', '综合分析题'];
const sourceStyleOptions = ['真题风格模拟', '近5年真题风格', '高频考点', '新题型预测', 'AI原创'];
const practicePurposeOptions = ['专项巩固', '薄弱点突破', '速度训练', '考前冲刺', '错题变式'];

const isSubmitted = computed(() => store.isFinished || Boolean(submittedIndexes.value[String(store.currentQuestionIndex)]));
const isSharedMaterialQuestion = computed(() => Boolean(store.currentQuestion?.material));
const showPracticeFooter = computed(() => !isCenterMode.value && sessionMode.value === 'practice' && store.questions.length > 0 && !isSharedMaterialQuestion.value);
const currentAnswerDetail = computed(() => {
  const questionId = store.currentQuestion?.id;
  return questionId ? answerDetails.value[questionId] : undefined;
});

onMounted(async () => {
  await initializePracticeRoute();
  window.addEventListener(TASK_CHANGED_EVENT, handleTaskChanged);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('click', closeHeaderModuleMenu);
});

async function initializePracticeRoute() {
  const rawContext = practiceFlowService.readStartContext();
  let context = rawContext.needsGeneration && !rawContext.sourceRef
    ? practiceFlowService.writeStartContext({ ...rawContext, needsGeneration: false })
    : rawContext;
  context = await restorePendingGenerationContext(context);
  selectedModule.value = context.module;
  selectedQuestionCount.value = context.questionCount;
  selectedKnowledgePoints.value = context.knowledgePoints || (context.knowledgePoint ? [context.knowledgePoint] : []);
  selectedDifficulty.value = context.difficulty || selectedDifficulty.value;
  selectedQuestionType.value = context.questionType || selectedQuestionType.value;
  selectedSourceStyle.value = context.sourceStyle || selectedSourceStyle.value;
  selectedPracticePurpose.value = context.practicePurpose || selectedPracticePurpose.value;
  selectedTimeLimitMinutes.value = context.timeLimitMinutes || 0;
  if (route.name === 'VuePracticeCenter') {
    isCenterMode.value = true;
    stopTimer();
    clearDraftTimer();
    store.showCenter();
    await store.fetchRecentSessions();
    return;
  }

  isCenterMode.value = false;
  await reloadPracticeDetail(context);
  submittedIndexes.value = {};
  answerDetails.value = {};
  await restoreCompletedSessionForContext(context);
  void store.fetchRecentSessions();
  if (!store.isFinished) startTimerIfReady();
}

onUnmounted(() => {
  window.removeEventListener(TASK_CHANGED_EVENT, handleTaskChanged);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  document.removeEventListener('click', closeHeaderModuleMenu);
  saveDraftNow();
  saveTimerState(store.isFinished ? 'stopped' : 'running');
  stopTimer();
  clearDraftTimer();
  clearAutoAdvanceTimer();
  store.reset(); // Clean up when leaving the page
});

const handleSelect = (optionIndex: number) => {
  store.selectAnswer(optionIndex);
  scheduleDraftSave();
  scheduleAutoAdvanceAfterSelect();
};

const elapsedText = computed(() => formatDuration(elapsedMs.value));
const sessionMetaText = computed(() => {
  if (!store.questions.length) return isWaitingForGeneratedQuestions.value ? '生成中' : '待生成';
  return `${elapsedText.value} · ${store.currentQuestionIndex + 1}/${store.questions.length}`;
});
const currentSessionModule = computed(() => store.module || store.context?.module || selectedModule.value);
const answeredCount = computed(() => store.userAnswers.filter((answer) => answer !== null).length);
const unansweredCount = computed(() => Math.max(0, store.questions.length - answeredCount.value));
const submittedCorrectCount = computed(() => store.questions.filter((question, index) => submittedIndexes.value[String(index)] && store.userAnswers[index] === question.answer).length);
const submittedWrongCount = computed(() => store.questions.filter((question, index) => submittedIndexes.value[String(index)] && store.userAnswers[index] !== null && store.userAnswers[index] !== question.answer).length);
const isLastQuestion = computed(() => store.currentQuestionIndex >= store.questions.length - 1);
const nextButtonText = computed(() => {
  if (store.isFinished && isLastQuestion.value) return '已交卷';
  return isLastQuestion.value ? '交卷' : '下一题';
});
const submitConfirmText = computed(() => {
  const base = `已答 ${answeredCount.value}/${store.questions.length} 题，提交后将生成批改结果并保存本次练习。`;
  if (unansweredCount.value > 0) return `${base} 还有 ${unansweredCount.value} 题未答，确认提交吗？`;
  return `${base} 确认提交吗？`;
});
const currentGenerationTask = computed(() => {
  const sourceRef = store.context?.sourceRef || practiceFlowService.readStartContext().sourceRef;
  if (!sourceRef) return undefined;
  return tasksStore.tasks.find((task) => task.id === sourceRef);
});
const isWaitingForGeneratedQuestions = computed(() => {
  const task = currentGenerationTask.value;
  return Boolean(task && ['queued', 'running', 'retrying', 'paused'].includes(task.status));
});
const emptyQuestionTitle = computed(() => {
  if (store.error) return '题目加载失败';
  if (currentGenerationTask.value?.status === 'cancelled') return '任务已取消';
  if (currentGenerationTask.value?.status === 'failed') return '生成失败';
  if (isWaitingForGeneratedQuestions.value) return 'AI 正在生成题目';
  if (store.context?.needsGeneration) return '选择生成方式';
  return '暂无可练习题目';
});
const emptyQuestionText = computed(() => {
  if (store.error) return store.error;
  if (currentGenerationTask.value?.status === 'cancelled') return `${store.module || '专项练习'} · ${store.context?.questionCount || 10} 题。可以重新生成。`;
  if (currentGenerationTask.value?.status === 'failed') return currentGenerationTask.value.error || '生成失败，可以重新发起。';
  if (isWaitingForGeneratedQuestions.value) {
    const task = currentGenerationTask.value;
    return task?.progressText || task?.detail || '正在调用大模型接口生成练习题，完成后会自动进入刷题。';
  }
  if (store.context?.needsGeneration) {
    return `${store.module || '专项练习'} · ${store.context.questionCount || 10} 题。确认后由 AI 生成题目并写入本地题库。`;
  }
  return '可以先生成新题，或等待本地题库导入完成。';
});
const centerMeta = computed(() => {
  const total = store.recentSessions.reduce((sum, session) => sum + session.questionCount, 0);
  return store.recentSessions.length ? `最近 ${store.recentSessions.length} 次 · ${total} 题` : '专项练习 · 错题回流';
});
const lectureContent = computed(() => {
  const lecture = store.lecture;
  if (lecture) return lecture;
  const module = store.module || '专项练习';
  const point = store.knowledgePoint || module;
  return {
    title: `${point}讲义`,
    summary: '这组题还没有绑定讲义。新生成的题组会在生成时同步产出结构化讲义，并与题组关联；历史旧题组如果没有讲义记录，只能展示这个提示。',
    methods: ['先回到刷题中心重新生成本组题，系统会同步保存讲义和题目。'],
    traps: ['旧题组没有讲义资产，不能用通用模板冒充真实课件。'],
    steps: ['完成当前题组后，可以重新生成同模块题组，新的讲义会随题组一起保存。'],
    reviewFocus: ['复盘时优先记录错题对应考点，后续讲义会围绕这些考点复用。']
  };
});
const lectureSummary = computed(() => {
  return lectureContent.value.summary;
});
const moduleCards = computed(() => moduleOptions.map((name) => {
  const latest = store.recentSessions.find((session) => session.module === name);
  return {
    name,
    short: name.slice(0, 1),
    meta: latest ? `${latest.date} · ${latest.accuracy}%` : '未开始'
  };
}));
const selectedKnowledgeGroups = computed(() => {
  const tree = DEFAULT_KNOWLEDGE_TREE[selectedModule.value] || {};
  return Object.entries(tree).map(([name, points]) => ({ name, points }));
});
const historyGroups = computed(() => {
  const completedSourceRefs = new Set(historySessions.value.map((session) => session.sourceFile).filter(Boolean));
  const items: PracticeHistoryItem[] = [
    ...historySessions.value.map((session) => ({ ...session, kind: 'session' as const })),
    ...generatedHistoryBatches.value
      .filter((batch) => !completedSourceRefs.has(batch.sourceRef))
      .map((batch) => ({
        ...batch,
        kind: 'generated' as const,
        date: new Date(batch.createdAt).toISOString().slice(0, 10),
        mode: 'practice' as PracticeMode,
        accuracy: 0,
        correctCount: 0
      }))
  ].sort((a, b) => {
    const aTime = a.kind === 'session' ? a.createdAt : a.updatedAt;
    const bTime = b.kind === 'session' ? b.createdAt : b.updatedAt;
    return bTime - aTime;
  });
  const grouped = new Map<string, PracticeHistoryItem[]>();
  items.forEach((item) => {
    const month = /^\d{4}-\d{2}/.test(item.date) ? item.date.slice(0, 7) : '未记录月份';
    grouped.set(month, [...(grouped.get(month) || []), item]);
  });
  return Array.from(grouped.entries()).map(([month, items]) => ({ month, items }));
});
const totalRecentQuestions = computed(() => store.recentSessions.reduce((sum, session) => sum + session.questionCount, 0));
const averageRecentAccuracy = computed(() => {
  if (!store.recentSessions.length) return '--';
  const value = Math.round(store.recentSessions.reduce((sum, session) => sum + session.accuracy, 0) / store.recentSessions.length);
  return `${value}%`;
});
const learningTools = [
  { title: '先学后练', sub: '考点精讲和配套训练', to: '/vue/study/lecture', icon: BookOpenIcon, tone: 'green' },
  { title: '错题巩固', sub: '重做错题和查漏补缺', to: '/vue/wrongbook', icon: RotateCcwIcon, tone: 'red' },
  { title: '模拟考试', sub: '限时套卷和阶段校准', to: '/vue/exam', icon: LayoutGridIcon, tone: 'blue' },
  { title: '每日积累', sub: '时政热点和知识速记', to: '/vue/digest', icon: NewspaperIcon, tone: 'orange' },
  { title: '知识地图', sub: '按大纲定位薄弱考点', to: '/vue/knowledge-graph', icon: MapIcon, tone: 'green' },
  { title: '质量追踪', sub: '看训练质量和趋势', to: '/vue/quality-dashboard', icon: BarChart3Icon, tone: 'blue' },
  { title: '考前冲刺', sub: '按考试倒计时压缩训练', to: '/vue/sprint', icon: FlameIcon, tone: 'orange' },
  { title: '错因报告', sub: '分析错误类型和建议', to: '/vue/error-report', icon: FileTextIcon, tone: 'red' }
];

async function requestSubmitPractice() {
  if (answeredCount.value === 0) {
    showActionMessage('请先作答再提交', 'error');
    return;
  }
  showSubmitConfirm.value = true;
}

async function confirmSubmitWithBlank() {
  showSubmitConfirm.value = false;
  await finishPractice();
}

async function finishPractice() {
  submittedIndexes.value = Object.fromEntries(store.questions.map((_, index) => [String(index), true]));
  store.isFinished = true;
  const session = await store.saveCurrentSession();
  if (session) {
    await restoreSessionAnswers(session.id);
    await enqueuePracticeGrade(session.id);
  }
  freezeTimer();
  clearDraft();
}

async function enqueuePracticeGrade(sessionId: string) {
  await aiChat.init();
  const reviewQuestions = store.questions.map((question, index) => ({
    questionId: question.id,
    module: question.module,
    knowledgePoint: question.knowledgePoint,
    stem: question.stem,
    options: question.options.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${option}`),
    userAnswer: store.userAnswers[index] === null ? '未作答' : String.fromCharCode(65 + Number(store.userAnswers[index])),
    correctAnswer: String.fromCharCode(65 + question.answer),
    explanation: question.explanation
  }));
  const result = await generationTaskService.enqueue({
    intent: 'practiceGrade',
    title: '行测错因分析',
    detail: `${store.module || '专项练习'} · ${reviewQuestions.length} 题`,
    module: store.module,
    sourceId: sessionId,
    payload: {
      practiceSessionId: sessionId,
      sessionId,
      chatSessionId: aiChat.session?.id,
      questionCount: reviewQuestions.length,
      questions: reviewQuestions
    }
  });
  await practiceSessionRepository.applyAIGrading(sessionId, reviewQuestions.map((question) => ({
    questionId: question.questionId
  })), result.task.id);
  await tasksStore.refresh();
}

async function restoreSessionAnswers(sessionId: string) {
  const rows = await practiceSessionRepository.answersForSession(sessionId);
  answerDetails.value = Object.fromEntries(rows.map((answer) => [answer.questionId, answer]));
}

async function restoreCompletedSessionForContext(context = store.context || practiceFlowService.readStartContext()): Promise<boolean> {
  if (!store.questions.length) return false;
  const sourceRef = context.sourceRef || uniqueQuestionSourceRef();
  const session = sourceRef ? await practiceSessionRepository.latestForSource(sourceRef) : undefined;
  const rows = session
    ? await practiceSessionRepository.answersForSession(session.id)
    : await practiceSessionRepository.latestAnswersForQuestionIds(store.questions.map((question) => question.id));
  if (!rows.length) return false;
  const sortedAnswers = [...rows].sort((a, b) => a.createdAt - b.createdAt);
  const answerByQuestionId = new Map(sortedAnswers.map((answer) => [answer.questionId, answer]));
  store.userAnswers = store.questions.map((question) => parseStoredAnswer(answerByQuestionId.get(question.id)?.userAnswer));
  answerDetails.value = Object.fromEntries(sortedAnswers.map((answer) => [answer.questionId, answer]));
  submittedIndexes.value = Object.fromEntries(store.questions
    .map((question, index) => answerByQuestionId.has(question.id) ? [String(index), true] : null)
    .filter((item): item is [string, true] => Boolean(item)));
  const fullyRestored = store.questions.every((question) => answerByQuestionId.has(question.id));
  if (fullyRestored) {
    store.isFinished = true;
    store.completedSessionId = session?.id || sortedAnswers[0]?.sessionId || null;
    elapsedMs.value = session?.durationMs || elapsedMs.value;
    freezeTimer();
  }
  return fullyRestored;
}

function uniqueQuestionSourceRef(): string | undefined {
  const refs = [...new Set(store.questions.map((question) => question.sourceFile).filter(Boolean))];
  return refs.length === 1 ? refs[0] : undefined;
}

function showActionMessage(message: string, type: 'info' | 'error' = 'info') {
  actionMessage.value = message;
  actionMessageType.value = type;
  window.setTimeout(() => {
    if (actionMessage.value === message) actionMessage.value = '';
  }, 1800);
}

async function askAIAboutQuestion(index: number) {
  const question = store.questions[index];
  if (!question) return;
  const userAnswer = store.userAnswers[index];
  const prompt = [
    `请帮我分析这道${store.module || '行测'}题，重点说明我为什么错、正确思路是什么、下次怎么避免。`,
    '',
    `题号：第 ${index + 1} 题`,
    `考点：${question.knowledgePoint || '未标注'}`,
    `题干：${question.stem}`,
    '',
    '选项：',
    ...question.options.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${option}`),
    '',
    `我的答案：${userAnswer === null ? '未作答' : String.fromCharCode(65 + userAnswer)}`,
    `正确答案：${String.fromCharCode(65 + question.answer)}`,
    '',
    `原解析：${question.explanation || '暂无解析'}`
  ].join('\n');
  await aiChat.open(prompt);
}

const generatePractice = async () => {
  if (isGeneratingPractice.value) return;
  const base = store.context || practiceFlowService.readStartContext();
  await enqueueAndOpenPractice({
    ...base,
    mode: base.mode === 'review' ? 'review' : 'practice',
    sourceRef: undefined,
    needsGeneration: false
  });
};

const cancelGenerationTask = async () => {
  const task = currentGenerationTask.value;
  const base = store.context || practiceFlowService.readStartContext();
  if (task) await tasksStore.cancel(task.id);
  let context = practiceFlowService.writeStartContext({
    ...base,
    sourceRef: undefined,
    needsGeneration: false
  });
  store.context = context;
  store.error = '';
  await tasksStore.refresh();
  stopTimer();
  elapsedMs.value = 0;
  answerDetails.value = {};
  if (!isCenterMode.value) await store.start(context);
};

const startDailyPlan = async () => {
  let context = practiceFlowService.writeStartContext({
    ...(store.context || practiceFlowService.readStartContext()),
    mode: 'practice',
    source: 'plan',
    questionCount: selectedQuestionCount.value || 10,
    sourceRef: undefined,
    needsGeneration: false,
    practicePurpose: '每日计划'
  });
  await enqueueAndOpenPractice(context);
};

const extraPractice = async () => {
  const context = store.context || practiceFlowService.readStartContext();
  clearDraft();
  submittedIndexes.value = {};
  answerDetails.value = {};
  elapsedMs.value = 0;
  await practiceFlowService.enqueueExtraPractice({
    ...context,
    module: store.module || context.module,
    knowledgePoint: store.knowledgePoint || context.knowledgePoint,
    questionCount: selectedQuestionCount.value || context.questionCount || 10
  });
  store.context = practiceFlowService.readStartContext();
  await tasksStore.refresh();
  await store.start(store.context);
  answerDetails.value = {};
  startTimerIfReady();
};

const startCustomPractice = async () => {
  if (isGeneratingPractice.value) return;
  const count = Math.max(5, Math.min(30, Number(selectedQuestionCount.value) || 10));
  clearDraft();
  submittedIndexes.value = {};
  answerDetails.value = {};
  let context = practiceFlowService.writeStartContext({
    ...(store.context || practiceFlowService.readStartContext()),
    module: selectedModule.value,
    knowledgePoint: selectedKnowledgePoints.value[0],
    knowledgePoints: selectedKnowledgePoints.value,
    mode: 'practice',
    source: 'practice-center',
    questionCount: count,
    questionType: selectedQuestionType.value,
    difficulty: selectedDifficulty.value,
    sourceStyle: selectedSourceStyle.value,
    practicePurpose: selectedPracticePurpose.value,
    timeLimitMinutes: selectedTimeLimitMinutes.value || undefined,
    sourceRef: undefined,
    needsGeneration: false
  });
  selectedQuestionCount.value = count;
  showModuleSheet.value = false;
  await enqueueAndOpenPractice(context);
};

const startModule = async (moduleName: string) => {
  selectedModule.value = moduleName;
  selectedKnowledgePoints.value = [];
  selectedQuestionCount.value = 10;
  let context = practiceFlowService.writeStartContext({
    ...(store.context || practiceFlowService.readStartContext()),
    module: moduleName,
    knowledgePoint: undefined,
    knowledgePoints: [],
    mode: 'practice',
    source: 'practice-center',
    questionCount: selectedQuestionCount.value,
    sourceRef: undefined,
    needsGeneration: false
  });
  clearDraft();
  submittedIndexes.value = {};
  answerDetails.value = {};
  sessionMode.value = 'practice';
  context = await restorePendingGenerationContext(context);
  await enterPracticeSession(context);
};

async function switchSessionModule(moduleName: string) {
  if (moduleName === currentSessionModule.value && !store.isFinished) return;
  selectedModule.value = moduleName;
  selectedKnowledgePoints.value = [];
  selectedQuestionCount.value = store.context?.questionCount || selectedQuestionCount.value || 10;
  let context = practiceFlowService.writeStartContext({
    ...(store.context || practiceFlowService.readStartContext()),
    module: moduleName,
    knowledgePoint: undefined,
    knowledgePoints: [],
    mode: 'practice',
    source: 'practice-center',
    questionCount: selectedQuestionCount.value,
    sourceRef: undefined,
    needsGeneration: false
  });
  clearDraft();
  submittedIndexes.value = {};
  answerDetails.value = {};
  sessionMode.value = 'practice';
  showHeaderModuleMenu.value = false;
  context = await restorePendingGenerationContext(context);
  await enterPracticeSession(context);
}

function closeHeaderModuleMenu() {
  showHeaderModuleMenu.value = false;
}

function selectCustomModule(moduleName: string) {
  selectedModule.value = moduleName;
  selectedKnowledgePoints.value = [];
}

function toggleKnowledgePoint(point: string) {
  selectedKnowledgePoints.value = selectedKnowledgePoints.value.includes(point)
    ? selectedKnowledgePoints.value.filter((item) => item !== point)
    : [...selectedKnowledgePoints.value, point];
}

async function loadHistorySessions() {
  const module = store.module || selectedModule.value;
  const [sessions, batches] = await Promise.all([
    practiceSessionRepository.historyForModule(module, 60),
    questionRepository.generatedBatches(module, 60)
  ]);
  historySessions.value = sessions;
  generatedHistoryBatches.value = batches;
}

function openLearningTool(tool: { to: string }) {
  router.push(tool.to);
}

async function enterPracticeSession(context = practiceFlowService.readStartContext()) {
  isCenterMode.value = false;
  context = await restorePendingGenerationContext(context);
  store.context = context;
  if (route.name !== 'VuePracticeSession') {
    await router.push('/vue/practice/session');
    return;
  }
  await store.start(context);
  const restoredCompleted = await restoreCompletedSessionForContext(context);
  if (!restoredCompleted) startTimerIfReady();
}

async function enqueueAndOpenPractice(context: ReturnType<typeof practiceFlowService.readStartContext>) {
  isGeneratingPractice.value = true;
  actionMessage.value = '正在创建生成任务...';
  actionMessageType.value = 'info';
  store.error = '';
  try {
    const result = await practiceFlowService.enqueueGeneration(context);
    const next = practiceFlowService.readStartContext();
    store.context = next;
    await tasksStore.refresh();
    actionMessage.value = result.reused ? '已有同类生成任务，已为你恢复进度' : '生成任务已创建';
    actionMessageType.value = 'info';
    await enterPracticeSession(next);
    window.setTimeout(() => {
      if (actionMessageType.value === 'info') actionMessage.value = '';
    }, 1800);
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成任务创建失败';
    actionMessage.value = message;
    actionMessageType.value = 'error';
    store.error = message;
    const next = practiceFlowService.writeStartContext({
      ...context,
      sourceRef: undefined,
      needsGeneration: false
    });
    store.context = next;
    await tasksStore.refresh();
    if (!isCenterMode.value) {
      await store.start(next);
      answerDetails.value = {};
      store.error = message;
    }
  } finally {
    isGeneratingPractice.value = false;
  }
}

const showCenter = () => {
  isCenterMode.value = true;
  clearDraft();
  stopTimer();
  store.showCenter();
  if (route.name !== 'VuePracticeCenter') void router.push('/vue/practice');
  void store.fetchRecentSessions();
};

async function restorePendingGenerationContext(context: ReturnType<typeof practiceFlowService.readStartContext>) {
  await tasksStore.refresh();
  if (context.sourceRef) return context;
  const task = tasksStore.tasks.find((item) => isActivePracticeGenerationTask(item) && taskMatchesPracticeContext(item, context))
    || tasksStore.tasks.find((item) => isRecoverablePracticeGenerationTask(item) && taskMatchesPracticeContext(item, context));
  if (!task) return context;
  return practiceFlowService.writeStartContext({
    ...context,
    sourceRef: task.id,
    questionIds: undefined,
    needsGeneration: false
  });
}

function isActivePracticeGenerationTask(task: LocalTask): boolean {
  return ['queued', 'running', 'retrying', 'paused'].includes(task.status)
    && (task.type === 'generate' || task.type === 'redo')
    && (task.payload?.intent === 'practice' || task.payload?.intent === 'redo');
}

function isRecoverablePracticeGenerationTask(task: LocalTask): boolean {
  return ['done', 'failed'].includes(task.status)
    && (task.type === 'generate' || task.type === 'redo')
    && (task.payload?.intent === 'practice' || task.payload?.intent === 'redo');
}

function taskMatchesPracticeContext(task: LocalTask, context: ReturnType<typeof practiceFlowService.readStartContext>): boolean {
  const expectedSourceId = practiceFlowService.generationSourceId(context);
  const payload = task.payload || {};
  if (String(payload.sourceId || '') === expectedSourceId) return true;
  if (task.lockKey?.endsWith(`:${expectedSourceId}`)) return true;
  if (String(payload.module || '') !== context.module) return false;
  if (String(payload.mode || 'practice') !== context.mode) return false;
  if (String(payload.date || '') !== context.date) return false;
  if (Number(payload.questionCount || context.questionCount) !== context.questionCount) return false;
  const taskPoint = String(payload.knowledgePoint || '');
  const contextPoint = context.knowledgePoint || '';
  if (taskPoint !== contextPoint) return false;
  const taskType = String(payload.questionType || '');
  const contextType = context.questionType || '';
  if (taskType && contextType && taskType !== contextType) return false;
  const taskDifficulty = String(payload.difficulty || '');
  const contextDifficulty = context.difficulty || '';
  if (taskDifficulty && contextDifficulty && taskDifficulty !== contextDifficulty) return false;
  return true;
}

async function discardCurrentSession() {
  showHistorySheet.value = false;
  const sourceRef = store.context?.sourceRef || uniqueQuestionSourceRef();
  if (!sourceRef) {
    showActionMessage('当前题组没有可删除的生成文件', 'error');
    return;
  }
  try {
    const result = await questionRepository.discardGeneratedBatch(sourceRef);
    const nextContext = practiceFlowService.writeStartContext({
      ...(store.context || practiceFlowService.readStartContext()),
      sourceRef: undefined,
      questionIds: undefined,
      needsGeneration: true
    });
    clearDraft();
    answerDetails.value = {};
    submittedIndexes.value = {};
    await tasksStore.refresh();
    stopTimer();
    elapsedMs.value = 0;
    isCenterMode.value = false;
    await reloadPracticeDetail(nextContext);
    showActionMessage(result.questions ? `已丢弃本组 ${result.questions} 题` : '本组已清理');
  } catch (error) {
    showActionMessage(error instanceof Error ? error.message : '丢弃失败', 'error');
    return;
  }
}

async function reloadPracticeDetail(context: ReturnType<typeof practiceFlowService.readStartContext>) {
  await store.start(context);
  if (!store.questions.length) {
    store.context = context;
    store.module = context.module;
    store.knowledgePoint = context.knowledgePoint;
    store.mode = context.mode;
    store.isLoading = false;
  }
}

async function handleTaskChanged(event: Event) {
  const taskId = (event as CustomEvent<{ taskId?: string }>).detail?.taskId;
  if (!taskId) return;

  await tasksStore.refresh();
  const task = await taskStore.get(taskId);
  if (task?.type === 'grade' && task.payload?.intent === 'practiceGrade') {
    const sessionId = String(task.payload.sessionId || '');
    if (sessionId && sessionId === store.completedSessionId) await restoreSessionAnswers(sessionId);
    return;
  }
  const sourceRef = store.context?.sourceRef || practiceFlowService.readStartContext().sourceRef;
  if (!sourceRef || taskId !== sourceRef) return;
  if (task?.status === 'done' && reloadedSourceRef.value !== sourceRef) {
    reloadedSourceRef.value = sourceRef;
    submittedIndexes.value = {};
    answerDetails.value = {};
    clearDraft();
    if (route.name !== 'VuePracticeSession') {
      await router.push('/vue/practice/session');
      return;
    }
    await reloadPracticeDetail(practiceFlowService.readStartContext());
    const restoredCompleted = await restoreCompletedSessionForContext(practiceFlowService.readStartContext());
    if (!restoredCompleted) startTimerIfReady();
  }
  if (task?.status === 'failed') {
    store.error = task.error || '生成任务失败';
  }
  if (task?.status === 'cancelled') {
    const context = practiceFlowService.writeStartContext({
      ...(store.context || practiceFlowService.readStartContext()),
      sourceRef: undefined,
      needsGeneration: false
    });
    store.context = context;
    store.error = '';
    stopTimer();
    elapsedMs.value = 0;
    answerDetails.value = {};
    if (!isCenterMode.value) await store.start(context);
  }
}

async function openHistoryItem(item: PracticeHistoryItem) {
  const answerRecords = item.kind === 'session'
    ? await practiceSessionRepository.answersForSession(item.id)
    : [];
  const sortedAnswers = [...answerRecords].sort((a, b) => a.createdAt - b.createdAt);
  const questionIds = item.kind === 'session'
    ? sortedAnswers.map((answer) => answer.questionId).filter(Boolean)
    : [];
  const context = practiceFlowService.writeStartContext({
    module: item.module || '专项练习',
    date: item.date,
    mode: item.mode,
    source: 'practice-center',
    questionCount: item.questionCount,
    sourceRef: item.kind === 'session' ? item.sourceFile : item.sourceRef,
    questionIds,
    needsGeneration: false
  });
  showHistorySheet.value = false;
  clearDraft();
  submittedIndexes.value = {};
  answerDetails.value = {};
  isCenterMode.value = false;
  await store.start(context);
  if (item.kind === 'session') {
    const answerByQuestionId = new Map(sortedAnswers.map((answer) => [answer.questionId, answer]));
    store.userAnswers = store.questions.map((question) => parseStoredAnswer(answerByQuestionId.get(question.id)?.userAnswer));
    answerDetails.value = Object.fromEntries(sortedAnswers.map((answer) => [answer.questionId, answer]));
    submittedIndexes.value = Object.fromEntries(store.questions.map((_, index) => [String(index), true]));
    store.isFinished = true;
    store.completedSessionId = item.id;
    elapsedMs.value = item.durationMs || 0;
    freezeTimer();
  } else {
    answerDetails.value = {};
    startTimerIfReady();
  }
}

function parseStoredAnswer(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === null || raw === '') return null;
  const text = String(raw).trim();
  if (/^\d+$/.test(text)) return Number(text);
  const code = text.toUpperCase().charCodeAt(0);
  return code >= 65 && code <= 90 ? code - 65 : null;
}

function historyStateText(item: PracticeHistoryItem): string {
  return item.kind === 'generated' ? '未完成' : `${item.accuracy}%`;
}

function historyTitleText(item: PracticeHistoryItem): string {
  return item.module || '专项练习';
}

function historyDetailText(item: PracticeHistoryItem): string {
  const time = new Date(item.kind === 'session' ? item.createdAt : item.updatedAt).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const point = item.kind === 'generated' && item.knowledgePoint ? ` · ${item.knowledgePoint}` : '';
  const source = item.kind === 'generated' ? '生成' : '交卷';
  return `${time}${source} · ${item.questionCount}题${point}`;
}

function isCurrentHistoryItem(item: PracticeHistoryItem): boolean {
  const sourceRef = item.kind === 'session' ? item.sourceFile : item.sourceRef;
  return Boolean(sourceRef && sourceRef === store.context?.sourceRef);
}

function modeText(mode: PracticeMode): string {
  const map: Record<PracticeMode, string> = {
    practice: '练习',
    review: '复习',
    mock: '模考',
    essay: '申论',
    diagnostic: '诊断'
  };
  return map[mode];
}

function sheetClass(index: number) {
  const submitted = Boolean(submittedIndexes.value[String(index)]);
  const userAnswer = store.userAnswers[index];
  const correct = submitted && userAnswer === store.questions[index]?.answer;
  const wrong = submitted && userAnswer !== null && userAnswer !== store.questions[index]?.answer;
  return {
    current: index === store.currentQuestionIndex,
    answered: userAnswer !== null && !submitted,
    submitted,
    correct,
    wrong
  };
}

function jumpTo(index: number) {
  clearAutoAdvanceTimer();
  store.currentQuestionIndex = index;
  scheduleDraftSave();
}

function prevQuestion() {
  if (store.currentQuestionIndex <= 0) return;
  clearAutoAdvanceTimer();
  store.currentQuestionIndex -= 1;
  scheduleDraftSave();
}

async function nextQuestionByNavigation() {
  clearAutoAdvanceTimer();
  if (isLastQuestion.value) {
    if (store.isFinished) return;
    await requestSubmitPractice();
    return;
  }
  await store.nextQuestion();
  scheduleDraftSave();
}

function scheduleAutoAdvanceAfterSelect() {
  clearAutoAdvanceTimer();
  if (isCenterMode.value || sessionMode.value !== 'practice' || store.isFinished || isLastQuestion.value) return;
  const selectedIndex = store.currentQuestionIndex;
  autoAdvanceTimerId = window.setTimeout(async () => {
    autoAdvanceTimerId = null;
    if (store.isFinished || sessionMode.value !== 'practice' || store.currentQuestionIndex !== selectedIndex || isLastQuestion.value) return;
    await store.nextQuestion();
    scheduleDraftSave();
  }, 420);
}

function clearAutoAdvanceTimer() {
  if (autoAdvanceTimerId !== null) {
    window.clearTimeout(autoAdvanceTimerId);
    autoAdvanceTimerId = null;
  }
}

function handleQuestionTouchStart(event: TouchEvent) {
  if (sessionMode.value !== 'practice' || !store.questions.length) return;
  const touch = event.touches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
  touchStartTime = Date.now();
  questionSwiping = false;
}

function handleQuestionTouchMove(event: TouchEvent) {
  if (sessionMode.value !== 'practice' || !touchStartTime) return;
  const touch = event.touches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  if (Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy) * 2) {
    questionSwiping = true;
  }
}

async function handleQuestionTouchEnd(event: TouchEvent) {
  if (!questionSwiping || sessionMode.value !== 'practice') {
    questionSwiping = false;
    return;
  }
  questionSwiping = false;
  const elapsed = Date.now() - touchStartTime;
  touchStartTime = 0;
  if (elapsed < 50 || elapsed > 1500) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - touchStartX;
  if (Math.abs(dx) <= 80) return;
  if (dx < 0) await nextQuestionByNavigation();
  else prevQuestion();
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function draftKey(context = store.context || practiceFlowService.readStartContext()): string {
  const source = context.sourceRef || context.questionIds?.join('-') || context.source || 'local';
  return `practice-draft:${context.mode}:${context.module}:${context.knowledgePoint || ''}:${source}`;
}

function saveDraftNow() {
  if (store.isLoading || store.isFinished || !store.context || !store.questions.length) return;
  const snapshot: PracticeDraftSnapshot = {
    context: store.context,
    questions: store.questions,
    currentQuestionIndex: store.currentQuestionIndex,
    userAnswers: store.userAnswers,
    submittedIndexes: Object.keys(submittedIndexes.value).map(Number),
    startedAt: store.startedAt,
    savedAt: Date.now()
  };
  localStorage.setItem(draftKey(store.context), JSON.stringify(snapshot));
}

function scheduleDraftSave() {
  clearDraftTimer();
  draftTimerId = window.setTimeout(saveDraftNow, 180);
}

function clearDraftTimer() {
  if (draftTimerId !== null) {
    window.clearTimeout(draftTimerId);
    draftTimerId = null;
  }
}

function clearDraft() {
  if (!store.context) return;
  localStorage.removeItem(draftKey(store.context));
}

type TimerState = 'running' | 'stopped';

function timerKey(context = store.context || practiceFlowService.readStartContext()): string {
  return `practice-timer:${context.mode}:${context.module}:${context.date}:${context.sourceRef || context.knowledgePoint || 'current'}`;
}

function readTimerState(): { elapsedMs: number; state: TimerState; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(timerKey());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveTimerState(state: TimerState = 'running') {
  if (!store.context || !store.questions.length) return;
  localStorage.setItem(timerKey(store.context), JSON.stringify({
    elapsedMs: elapsedMs.value,
    state,
    savedAt: Date.now()
  }));
}

function startTimerIfReady() {
  if (isCenterMode.value || store.isFinished || !store.questions.length) {
    stopTimer();
    elapsedMs.value = 0;
    return;
  }
  startTimer();
}

function startTimer() {
  if (!store.questions.length) return;
  stopTimer();
  const saved = readTimerState();
  if (saved?.state === 'stopped') {
    elapsedMs.value = saved.elapsedMs || 0;
    return;
  }
  elapsedMs.value = saved?.elapsedMs || elapsedMs.value || 0;
  store.startedAt = Date.now() - elapsedMs.value;
  elapsedMs.value = Date.now() - store.startedAt;
  timerId = window.setInterval(() => {
    elapsedMs.value = store.startedAt ? Date.now() - store.startedAt : 0;
    if (Math.floor(elapsedMs.value / 1000) % 10 === 0) saveTimerState('running');
  }, 1000);
}

function stopTimer() {
  if (timerId !== null) {
    window.clearInterval(timerId);
    timerId = null;
  }
}

function freezeTimer() {
  saveTimerState('stopped');
  stopTimer();
}

function handleVisibilityChange() {
  if (document.hidden) {
    saveDraftNow();
    saveTimerState(store.isFinished ? 'stopped' : 'running');
    stopTimer();
  } else {
    startTimerIfReady();
  }
}

watch(
  () => [store.currentQuestionIndex, store.userAnswers.join(','), Object.keys(submittedIndexes.value).join(',')],
  () => scheduleDraftSave()
);

watch(
  () => route.name,
  () => {
    void initializePracticeRoute();
  }
);

watch(
  () => showHistorySheet.value,
  (opened) => {
    if (opened) void loadHistorySessions();
  }
);
</script>

<style scoped>
.practice-notice {
  position: fixed;
  left: 50%;
  top: calc(10px + var(--app-safe-top));
  z-index: 80;
  max-width: calc(100vw - 32px);
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--color-ink-rgb), .82);
  color: #fff;
  box-shadow: 0 12px 28px rgba(28, 38, 58, .16);
  transform: translateX(-50%);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.practice-notice.error {
  background: rgba(210, 50, 44, .9);
}
.practice-page {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.practice-header {
  position: relative;
}
.compact-title .app-title-icon { width: 36px; height: 36px; border-radius: 12px; }
.session-title {
  min-width: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  text-align: center;
}
.session-title span,
.session-meta {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-module-trigger {
  width: 100%;
  max-width: min(240px, 58vw);
  min-width: 0;
  height: 22px;
  border: none;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  column-gap: 4px;
  padding: 0 2px;
  background: transparent;
  color: var(--text-color);
  font-family: inherit;
}
.session-module-trigger strong {
  grid-column: 2;
  min-width: 0;
  color: var(--text-color);
  font-size: var(--type-size-body-large);
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-module-trigger svg {
  grid-column: 3;
  justify-self: start;
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: var(--text-secondary-color);
  transition: transform .16s ease;
}
.session-module-trigger svg.open {
  transform: rotate(180deg);
}
.session-title span,
.session-meta {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.header-module-popover {
  position: fixed;
  top: calc(var(--app-safe-top) + 48px);
  left: 50vw;
  z-index: 12;
  width: min(256px, calc(100vw - 56px));
  padding: 6px;
  border-radius: 16px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  background: rgba(255, 255, 255, .9);
  box-shadow: 0 12px 30px rgba(28, 38, 58, .13);
  transform: translateX(-50%);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}
.header-module-popover button {
  height: 32px;
  border: none;
  border-radius: 11px;
  background: rgba(var(--color-ink-rgb), .045);
  color: var(--text-secondary-color);
  font-family: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.header-module-popover button.active {
  background: rgba(var(--color-brand-rgb), .1);
  color: var(--primary-color);
}
.module-pop-enter-active,
.module-pop-leave-active {
  transition: opacity .14s ease, transform .14s ease;
}
.module-pop-enter-from,
.module-pop-leave-to {
  opacity: 0;
  transform: translate(-50%, -4px);
}
.practice-center {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.center-hero {
  min-height: 106px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  background:
    linear-gradient(135deg, rgba(var(--color-brand-rgb), .12), rgba(255, 255, 255, .82)),
    rgba(255, 255, 255, .78);
}
.center-hero div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.center-hero span,
.center-hero em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}
.center-hero strong {
  color: var(--text-color);
  font-size: var(--type-size-page-title);
  line-height: 1.2;
}
.center-hero button {
  border: none;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: inherit;
  font-weight: var(--type-weight-semibold);
}
.center-hero button {
  min-width: 92px;
  height: 40px;
  color: #fff;
  background: var(--primary-color);
  flex-shrink: 0;
}
.center-hero svg {
  width: 15px;
  height: 15px;
}
.center-status {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.center-status article {
  min-height: 62px;
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  text-align: center;
}
.center-status strong {
  color: var(--text-color);
  font-size: var(--type-size-section-title);
  line-height: 1;
}
.center-status span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.primary-learning-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.learning-card {
  min-height: 116px;
  border: none;
  padding: 13px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-color);
  text-align: left;
  font-family: inherit;
}
.learning-card.blue {
  background: linear-gradient(145deg, rgba(var(--color-brand-rgb), .12), rgba(255, 255, 255, .84));
}
.learning-card.green {
  background: linear-gradient(145deg, rgba(52, 168, 83, .13), rgba(255, 255, 255, .84));
}
.learning-card > span,
.tool-icon {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--color-brand-rgb), .1);
  color: var(--primary-color);
}
.learning-card.green > span {
  color: var(--green-color);
  background: rgba(52, 168, 83, .12);
}
.learning-card svg,
.tool-icon svg {
  width: 18px;
  height: 18px;
}
.learning-card strong,
.tool-card strong {
  color: var(--text-color);
  font-size: var(--type-size-body);
}
.learning-card em,
.tool-card em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  line-height: 1.35;
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}
.tool-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}
.tool-card {
  min-height: 82px;
  border: none;
  padding: 11px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 9px;
  row-gap: 3px;
  align-items: center;
  text-align: left;
  font-family: inherit;
  color: var(--text-color);
}
.tool-card .tool-icon {
  grid-row: 1 / span 2;
}
.tool-card strong,
.tool-card em {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-icon.green {
  color: var(--green-color);
  background: rgba(52, 168, 83, .12);
}
.tool-icon.red {
  color: var(--red-color);
  background: rgba(255, 59, 48, .1);
}
.tool-icon.orange {
  color: #c26d00;
  background: rgba(232, 150, 10, .12);
}
.tool-icon.blue {
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .1);
}
.section-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.module-center-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.module-center-card {
  min-height: 104px;
  padding: 13px;
  border: none;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-color);
  text-align: left;
  font-family: inherit;
}
.module-center-card span {
  width: 30px;
  height: 30px;
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .1);
  font-size: var(--type-size-body);
  font-weight: var(--type-weight-semibold);
}
.module-center-card strong {
  font-size: var(--type-size-body-large);
}
.module-center-card em {
  max-width: 100%;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.center-recent {
  margin: 0;
}
.session-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.mode-tabs {
  margin: 2px var(--page-x) 0;
  padding: 0;
  border-radius: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  background: transparent;
  flex-shrink: 0;
}
.mode-tabs button {
  height: 30px;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  color: var(--text-secondary-color);
  background: transparent;
  font-family: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
.mode-tabs button.active {
  color: var(--primary-color);
  background: transparent;
  border-bottom-color: var(--primary-color);
  box-shadow: none;
}
.question-area {
  flex: 1;
  min-height: 0;
  padding: 6px var(--page-x) calc(70px + var(--app-safe-bottom));
  overflow-y: auto;
}
.lecture-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lecture-card > span {
  color: var(--primary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.lecture-card h4 {
  margin: 0;
  color: var(--text-color);
  font-size: var(--type-size-section-title);
}
.lecture-card p {
  margin: 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-body);
  line-height: 1.7;
}
.lecture-points {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(var(--color-ink-rgb), .045);
}
.lecture-points strong {
  color: var(--text-color);
  font-size: var(--type-size-secondary);
}
.lecture-points em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  font-style: normal;
  line-height: 1.55;
}
.empty-question {
  min-height: 360px;
}
.empty-question p {
  margin-bottom: 8px;
}
.recent-panel {
  margin: 0 16px 14px;
  padding: 14px;
  border: 1px solid rgba(var(--color-ink-rgb), .06);
  border-radius: 14px;
  background: rgba(255, 255, 255, .82);
  box-shadow: 0 10px 26px rgba(28, 38, 58, .06);
}
.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.section-title strong {
  font-size: var(--type-size-body-large);
}
.section-title span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.recent-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 42px;
  padding: 8px 0;
  border-top: 1px solid rgba(var(--color-ink-rgb), .06);
}
.recent-row div {
  min-width: 0;
}
.recent-row strong,
.recent-row span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-row strong {
  font-size: var(--type-size-secondary);
}
.recent-row span {
  margin-top: 2px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
}
.recent-row em {
  flex-shrink: 0;
  color: var(--primary-color);
  font-size: var(--type-size-caption);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}
.answer-sheet {
  margin: 14px 16px 0;
  padding: 14px;
  border: 1px solid rgba(var(--color-ink-rgb), .06);
  border-radius: 14px;
  background: rgba(255, 255, 255, .78);
  box-shadow: 0 10px 26px rgba(28, 38, 58, .05);
}
.sheet-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 8px;
}
.sheet-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
  margin-bottom: 10px;
}
.sheet-summary span {
  min-height: 38px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--text-secondary-color);
  background: rgba(245, 246, 250, .78);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.sheet-summary strong {
  color: var(--text-color);
  font-size: var(--type-size-secondary);
}
.sheet-legend {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.sheet-legend span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.sheet-legend i {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: rgba(var(--color-ink-rgb), .1);
}
.sheet-legend i.answered {
  background: rgba(var(--color-brand-rgb), .22);
}
.sheet-legend i.correct {
  background: rgba(52, 168, 83, .36);
}
.sheet-legend i.wrong {
  background: rgba(255, 59, 48, .32);
}
.sheet-grid button {
  aspect-ratio: 1;
  border: none;
  border-radius: 999px;
  background: rgba(var(--color-ink-rgb), .06);
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.sheet-grid button.answered {
  background: rgba(var(--color-brand-rgb), .12);
  color: var(--primary-color);
}
.sheet-grid button.submitted {
  background: rgba(52, 168, 83, .14);
  color: var(--green-color);
}
.sheet-grid button.correct {
  background: rgba(52, 168, 83, .16);
  color: var(--green-color);
}
.sheet-grid button.wrong {
  background: rgba(255, 59, 48, .14);
  color: var(--red-color);
}
.sheet-grid button.current {
  box-shadow: inset 0 0 0 2px var(--primary-color);
}
.footer {
  position: fixed;
  left: max(12px, env(safe-area-inset-left));
  right: max(12px, env(safe-area-inset-right));
  bottom: var(--app-bottom-nav-offset);
  z-index: 7;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  padding: 6px;
  border: 1px solid rgba(255, 255, 255, .62);
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(255, 255, 255, .9), rgba(255, 255, 255, .74));
  box-shadow:
    0 16px 38px rgba(28, 38, 58, .14),
    inset 0 1px 0 rgba(255, 255, 255, .8);
  backdrop-filter: blur(18px) saturate(1.12);
  -webkit-backdrop-filter: blur(18px) saturate(1.12);
}
.nav-btn {
  flex: 0 0 72px;
  height: 42px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary-color);
  font-weight: var(--type-weight-semibold);
}
.nav-btn:disabled {
  opacity: .45;
}
.action-btn {
  flex: 1;
  min-height: 42px;
  padding: 0 12px;
  font-size: var(--type-size-body-large);
  font-weight: var(--type-weight-semibold);
  border: none;
  border-radius: 12px;
  background-color: var(--primary-color);
  color: white;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: inherit;
}
.action-btn svg { width: 16px; height: 16px; }
.action-btn:disabled {
  background-color: #a0c3f0;
}
.secondary-action {
  min-width: 160px;
  min-height: 42px;
  border: 1px solid rgba(var(--color-ink-rgb), .08);
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-color);
  background: rgba(255, 255, 255, .76);
  font-weight: var(--type-weight-semibold);
  font-family: inherit;
}
.secondary-action svg { width: 15px; height: 15px; color: var(--primary-color); }
.sheet-btn {
  flex: 1 1 auto;
  min-width: 96px;
  height: 42px;
  border: none;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(255, 255, 255, .86);
  box-shadow: 0 8px 20px rgba(var(--color-brand-rgb), .12);
  color: var(--primary-color);
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
  font-family: inherit;
}
.sheet-btn span {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: var(--primary-color);
  font-size: var(--type-size-micro);
}
.module-sheet {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.filter-block {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.filter-block > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.filter-block > span em {
  color: var(--primary-color);
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}
.filter-block.two-column {
  display: grid;
  grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr);
  gap: 10px;
}
.module-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}
.module-grid button {
  height: 36px;
  border: none;
  border-radius: 10px;
  background: rgba(245, 246, 250, .72);
  color: var(--text-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
  font-family: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.module-grid button.active {
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .1);
}
.topic-groups {
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
  -webkit-overflow-scrolling: touch;
}
.topic-groups section {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.topic-groups strong {
  color: var(--text-color);
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
.topic-groups section > div,
.option-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.topic-groups button,
.option-row button {
  min-height: 34px;
  border: none;
  border-radius: 999px;
  padding: 0 12px;
  background: rgba(245, 246, 250, .72);
  color: var(--text-secondary-color);
  font-family: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.topic-groups button.active,
.option-row button.active {
  background: rgba(var(--color-brand-rgb), .1);
  color: var(--primary-color);
}
.option-row button {
  flex: 0 0 auto;
}
.count-field {
  display: flex;
  min-width: 0;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: none;
  border-radius: 13px;
  padding: 0 10px;
  background: rgba(245, 246, 250, .72);
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
.count-field span {
  flex-shrink: 0;
}
.count-field input,
.count-field select {
  min-width: 0;
  width: 92px;
  height: 38px;
  border: none;
  border-radius: 10px;
  padding: 0 10px;
  background: rgba(255, 255, 255, .72);
  color: var(--text-color);
  font: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.count-field select {
  width: 100%;
}
.history-date-list,
.history-sheet-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.history-date-list section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.history-date-list section > strong {
  padding: 0 2px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.history-sheet-row {
  position: relative;
  width: 100%;
  min-height: 58px;
  border: none;
  border-radius: 14px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, .74);
  color: var(--text-color);
  text-align: left;
  font-family: inherit;
  box-shadow: 0 8px 20px rgba(28, 38, 58, .045);
}
.history-sheet-row span,
.history-sheet-row em {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-sheet-row span {
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
.history-sheet-row strong {
  color: var(--primary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.history-sheet-row strong.pending {
  color: #a15c00;
}
.history-sheet-row em {
  grid-column: 1 / -1;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}
.history-sheet-row small {
  position: absolute;
  right: 10px;
  bottom: 8px;
  color: var(--green-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.sheet-empty {
  min-height: 80px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, .72);
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
@media (max-width: 380px) {
  .module-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .nav-btn { flex-basis: 64px; font-size: var(--type-size-caption); }
  .sheet-btn { min-width: 82px; font-size: var(--type-size-caption); }
}
</style>
