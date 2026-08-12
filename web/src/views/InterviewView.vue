<template>
  <div class="interview-page app-page">
    <PageHeader :title="headerTitle" :meta="headerMeta" :level="2">
      <template #leading>
        <button class="icon-button" type="button" aria-label="返回" @click="requestLeave">
          <ChevronLeftIcon />
        </button>
      </template>
    </PageHeader>

    <main class="app-page-scroll interview-scroll">
      <template v-if="stage === 'setup'">
        <section class="interview-hero app-card">
          <div class="hero-copy">
            <span class="hero-icon"><MicIcon /></span>
            <div>
              <strong>结构化面试训练</strong>
              <p>限时思考、模拟作答、AI 四维点评</p>
            </div>
          </div>
          <div class="stats-row">
            <div><strong>{{ stats.totalSessions }}</strong><span>练习次数</span></div>
            <div><strong>{{ stats.averageScore || '-' }}</strong><span>AI 平均分</span></div>
          </div>
        </section>

        <section class="setup-section">
          <SectionHeading title="题型范围">
            <template #action>
              <button type="button" @click="toggleAllTypes">{{ questionTypes.length === questionTypeOptions.length ? '清空' : '全选' }}</button>
            </template>
          </SectionHeading>
          <div class="chip-row">
            <button
              v-for="type in questionTypeOptions"
              :key="type"
              type="button"
              :class="{ active: questionTypes.includes(type) }"
              @click="toggleType(type)"
            >
              {{ type }}
            </button>
          </div>
        </section>

        <section class="setup-section">
          <SectionHeading title="训练难度" />
          <SegmentedControl v-model="difficulty" label="训练难度" :options="difficultyOptions" />
        </section>

        <button class="primary-button start-button" type="button" :disabled="!questionTypes.length || isStarting" @click="startInterview">
          <PlayIcon /> 开始模拟
        </button>

        <section class="history-section">
          <SectionHeading title="练习记录" meta="最近 5 条" />
          <AppStateView v-if="!history.length" compact title="暂无面试练习记录" description="完成一次模拟后会在这里沉淀复盘记录。" />
          <div v-else class="history-list">
            <button v-for="session in history" :key="session.id" type="button" class="history-row" @click="openSession(session)">
              <span class="history-icon"><MicIcon /></span>
              <span class="history-copy">
                <strong>{{ session.date }}</strong>
                <small>{{ session.questionCount }} 题 · 结构化面试</small>
              </span>
              <em v-if="session.score">{{ session.score.total }}</em>
              <small v-else>{{ session.reviewStatus === 'failed' ? '待重试' : '点评中' }}</small>
              <ChevronRightIcon />
            </button>
          </div>
        </section>
      </template>

      <template v-else-if="stage === 'session' && currentQuestion">
        <section class="session-status">
          <div>
            <span>{{ timerPhase === 'thinking' ? '思考阶段' : '作答阶段' }}</span>
            <strong :class="{ warning: timeLeft <= 20, danger: timeLeft <= 10 }">{{ timerText }}</strong>
          </div>
          <small>第 {{ currentIndex + 1 }} / {{ questions.length }} 题 · {{ currentQuestion.type }}</small>
        </section>

        <section class="question-panel">
          <h4>{{ currentQuestion.text }}</h4>
          <p v-if="timerPhase === 'thinking'">思考时先明确观点、分析层次和落脚措施。</p>
          <p v-else>围绕题目直接作答，避免背诵模板和空泛表态。</p>
        </section>

        <template v-if="timerPhase === 'thinking'">
          <button class="primary-button phase-button" type="button" @click="beginAnswering">
            <MicIcon /> 提前开始作答
          </button>
        </template>

        <template v-else>
          <div class="speech-panel">
            <button type="button" :class="{ recording: isRecording }" :disabled="!speechAvailable || isSpeechBusy" @click="toggleSpeech">
              <MicIcon />
              {{ speechButtonText }}
            </button>
            <span>{{ speechHint }}</span>
          </div>

          <textarea v-model="answerText" class="answer-input" placeholder="输入作答，或使用语音识别转写……" />

          <div class="session-actions">
            <button type="button" class="secondary-button" @click="skipQuestion"><SkipForwardIcon /> 跳过</button>
            <button type="button" class="primary-button" :disabled="!answerText.trim()" @click="submitAnswer"><SendIcon /> 提交作答</button>
          </div>
        </template>
      </template>

      <template v-else-if="stage === 'result' && resultSession">
        <section v-if="resultSession.score" class="result-summary app-card">
          <div class="result-score">
            <strong>{{ resultSession.score.total }}</strong>
            <span>AI 综合评分</span>
          </div>
          <div class="confidence">可信度 {{ Math.round(resultSession.score.confidence * 100) }}%</div>
        </section>

        <section v-if="resultSession.score" class="dimension-section">
          <SectionHeading title="能力维度" :meta="resultSession.score.rubricVersion" />
          <div class="dimension-list">
            <div v-for="item in resultSession.score.dimensions" :key="item.code" class="dimension-row">
              <div><span>{{ item.name }}</span><em>{{ item.score }}</em></div>
              <div class="dimension-track"><i :style="{ width: `${item.score}%` }"></i></div>
              <p>{{ item.comment }}</p>
            </div>
          </div>
        </section>

        <AiTaskPendingState
          v-if="visibleReviewTask && visibleReviewTask.status !== 'completed'"
          :task="visibleReviewTask"
          title="AI 正在进行面试深度点评"
          :description="visibleReviewTask.message || visibleReviewTask.detail || '将结合题目、真实作答和语音指标生成四维复盘。'"
          ready-action-label="重新点评"
          retry-action-label="重新点评"
          @start="enqueueAiReview"
          @retry="enqueueAiReview"
          @cancel="cancelAiReview"
        />

        <section v-else-if="!resultSession.score" class="review-placeholder app-card">
          <SparklesIcon />
          <div>
            <strong>{{ resultSession.reviewStatus === 'failed' ? '点评暂未完成' : '正在准备深度点评' }}</strong>
            <p>正式成绩只采用 AI rubric，不使用字数或连接词推断。</p>
          </div>
          <button v-if="resultSession.reviewStatus === 'failed'" type="button" @click="enqueueAiReview">重试</button>
        </section>

        <section v-if="resultSession.aiFeedback" class="review-section app-card">
          <SectionHeading title="AI 深度点评" />
          <MarkdownContent class="ai-review-content" :content="resultSession.aiFeedback" />
        </section>

        <section v-if="resultSession.aiSuggestions?.length" class="suggestion-section app-card">
          <SectionHeading title="下一步训练" />
          <ul>
            <li v-for="suggestion in resultSession.aiSuggestions" :key="suggestion">{{ suggestion }}</li>
          </ul>
        </section>

        <section class="answer-review-section">
          <SectionHeading title="作答回顾" />
          <article v-for="(item, index) in resultSession.answers" :key="item.question.id" class="answer-review-row">
            <div><span>第 {{ index + 1 }} 题</span><em>{{ item.question.type }}</em></div>
            <strong>{{ item.question.text }}</strong>
            <p :class="{ skipped: item.skipped }">{{ item.skipped ? '已跳过' : item.answer }}</p>
            <small v-if="item.speechMetrics">{{ item.speechMetrics.durationSeconds }} 秒 · {{ item.speechMetrics.wordsPerMinute }} 字/分 · 口头语 {{ item.speechMetrics.fillerCount }} 次</small>
          </article>
        </section>

        <div class="session-actions result-actions">
          <button type="button" class="secondary-button" @click="backToSetup"><ChevronLeftIcon /> 返回设置</button>
          <button type="button" class="primary-button" @click="startInterview"><RotateCcwIcon /> 再练一次</button>
        </div>
      </template>
    </main>

    <ConfirmDialog
      v-model="showLeaveConfirm"
      title="退出本次面试训练？"
      description="当前进度已保存，下次进入可继续作答。"
      confirm-text="保存并退出"
      @confirm="confirmLeave"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MicIcon,
  PlayIcon,
  RotateCcwIcon,
  SendIcon,
  SkipForwardIcon,
  SparklesIcon
} from 'lucide-vue-next';
import type { AgentRunView } from '@/modules/agent/public';
import { initializeTutorRuntime } from '@/composition-root/public';
import type { InterviewAnswer, InterviewDifficulty, InterviewQuestion, InterviewQuestionType, InterviewSession, InterviewStats } from '@/domain/interview';
import AiTaskPendingState from '@/components/AiTaskPendingState.vue';
import MarkdownContent from '@/components/MarkdownContent.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import ConfirmDialog from '@/components/layout/ConfirmDialog.vue';
import { AppStateView, SectionHeading, SegmentedControl } from '@/capabilities/design-system/public';
import { goBackOrHome } from '@/router/navigation';
import { speechRecognitionAdapter } from '@/platform/SpeechRecognitionAdapter';
import { INTERVIEW_QUESTION_TYPES, interviewRepository } from '@/services/InterviewRepository';

type InterviewStage = 'setup' | 'session' | 'result';
type TimerPhase = 'thinking' | 'answering';

const THINKING_SECONDS = 30;
const ANSWERING_SECONDS = 120;
const DRAFT_KEY = 'interview-session-draft:v2';
const router = useRouter();
const questionTypeOptions = INTERVIEW_QUESTION_TYPES;
const difficultyOptions = [
  { value: 'easy', label: '基础' },
  { value: 'medium', label: '标准' },
  { value: 'hard', label: '进阶' }
] as const;

const stage = ref<InterviewStage>('setup');
const difficulty = ref<InterviewDifficulty>('medium');
const questionTypes = ref<InterviewQuestionType[]>([...questionTypeOptions]);
const questions = ref<InterviewQuestion[]>([]);
const currentIndex = ref(0);
const answerText = ref('');
const speechTranscript = ref('');
const speechMetrics = ref<InterviewAnswer['speechMetrics']>();
const speechAvailable = ref(false);
const isRecording = ref(false);
const isSpeechBusy = ref(false);
const speechError = ref('');
const answers = ref<InterviewAnswer[]>([]);
const timerPhase = ref<TimerPhase>('thinking');
const timeLeft = ref(THINKING_SECONDS);
const timerDeadline = ref(0);
const timerId = ref<number | null>(null);
const timerTransitioning = ref(false);
const history = ref<InterviewSession[]>([]);
const stats = ref<InterviewStats>({ totalSessions: 0, averageScore: 0 });
const resultSession = ref<InterviewSession | null>(null);
const draftSaveTimer = ref<number | null>(null);
const visibleReviewTask = ref<AgentRunView>();
const reviewTaskId = ref('');
const isReviewing = ref(false);
const isStarting = ref(false);
const showLeaveConfirm = ref(false);
let reviewPollId: number | null = null;

interface InterviewDraft {
  stage: 'session';
  difficulty: InterviewDifficulty;
  questionTypes: InterviewQuestionType[];
  questions: InterviewQuestion[];
  currentIndex: number;
  answerText: string;
  speechTranscript: string;
  speechMetrics?: InterviewAnswer['speechMetrics'];
  answers: InterviewAnswer[];
  timerPhase: TimerPhase;
  timeLeft: number;
  savedAt: number;
}

const currentQuestion = computed(() => questions.value[currentIndex.value] || null);
const timerText = computed(() => `${String(Math.floor(timeLeft.value / 60)).padStart(2, '0')}:${String(timeLeft.value % 60).padStart(2, '0')}`);
const headerTitle = computed(() => stage.value === 'setup' ? '面试训练' : stage.value === 'session' ? currentQuestion.value?.type || '面试作答' : '面试复盘');
const headerMeta = computed(() => stage.value === 'setup' ? '结构化表达与深度复盘' : stage.value === 'session' ? `第 ${currentIndex.value + 1} / ${questions.value.length} 题` : resultSession.value?.date || 'AI 四维点评');
const speechButtonText = computed(() => {
  if (!speechAvailable.value) return '语音不可用';
  if (isSpeechBusy.value) return '处理中…';
  return isRecording.value ? '停止识别' : '语音作答';
});
const speechHint = computed(() => {
  if (speechError.value) return speechError.value;
  if (!speechAvailable.value) return '当前环境仅支持文本输入';
  if (isRecording.value) return '正在识别，结束后自动转写';
  if (speechMetrics.value) return `${speechMetrics.value.durationSeconds} 秒 · ${speechMetrics.value.wordsPerMinute} 字/分`;
  return '使用 iOS 本地语音识别，不上传音频';
});

onMounted(async () => {
  await loadStats();
  speechAvailable.value = await speechRecognitionAdapter.isAvailable();
  restoreDraft();
  document.addEventListener('visibilitychange', handleVisibilityChange);
  reviewPollId = window.setInterval(() => void refreshReviewTask(), 900);
  window.addEventListener('beforeunload', saveDraftNow);
});

onUnmounted(() => {
  saveDraftNow();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('beforeunload', saveDraftNow);
  if (reviewPollId !== null) window.clearInterval(reviewPollId);
  clearDraftTimer();
  stopTimer();
  if (isRecording.value) void speechRecognitionAdapter.stop().catch(() => undefined);
});

watch(answerText, scheduleDraftSave);
watch([stage, currentIndex, questions, answers, timerPhase], scheduleDraftSave, { deep: true });

async function loadStats() {
  stats.value = await interviewRepository.stats();
  history.value = await interviewRepository.latest(5);
}

function toggleType(type: InterviewQuestionType) {
  questionTypes.value = questionTypes.value.includes(type)
    ? questionTypes.value.filter((item) => item !== type)
    : [...questionTypes.value, type];
}

function toggleAllTypes() {
  questionTypes.value = questionTypes.value.length === questionTypeOptions.length ? [] : [...questionTypeOptions];
}

async function startInterview() {
  if (!questionTypes.value.length || isStarting.value) return;
  isStarting.value = true;
  clearDraft();
  const recentIds = new Set(history.value.flatMap((session) => session.answers.map((answer) => answer.question.id)));
  const generatedQuestions = await interviewRepository.questionPool().catch(() => []);
  questions.value = interviewRepository.pickQuestions(questionTypes.value, 3, recentIds, generatedQuestions);
  currentIndex.value = 0;
  answers.value = [];
  resultSession.value = null;
  resetAnswerState();
  stage.value = 'session';
  startTimer('thinking', THINKING_SECONDS);
  saveDraftNow();
  isStarting.value = false;
  void interviewRepository.ensureQuestionPool(questionTypes.value, difficulty.value, recentIds).catch(() => undefined);
}

function beginAnswering() {
  startTimer('answering', ANSWERING_SECONDS);
  saveDraftNow();
}

function startTimer(phase: TimerPhase, seconds: number) {
  stopTimer();
  timerPhase.value = phase;
  timeLeft.value = Math.max(0, seconds);
  timerDeadline.value = Date.now() + timeLeft.value * 1000;
  timerId.value = window.setInterval(() => void tickTimer(), 250);
  void tickTimer();
}

async function tickTimer() {
  if (timerTransitioning.value || stage.value !== 'session') return;
  timeLeft.value = Math.max(0, Math.ceil((timerDeadline.value - Date.now()) / 1000));
  if (timeLeft.value > 0) return;
  timerTransitioning.value = true;
  try {
    if (timerPhase.value === 'thinking') beginAnswering();
    else await pushAnswer(!answerText.value.trim());
  } finally {
    timerTransitioning.value = false;
  }
}

function stopTimer() {
  if (timerId.value !== null) window.clearInterval(timerId.value);
  timerId.value = null;
}

function submitAnswer() {
  if (answerText.value.trim()) void pushAnswer(false);
}

function skipQuestion() {
  void pushAnswer(true);
}

async function pushAnswer(skipped: boolean) {
  if (!currentQuestion.value || timerPhase.value !== 'answering') return;
  stopTimer();
  if (isRecording.value) await stopSpeech();
  answers.value.push({
    question: currentQuestion.value,
    answer: skipped ? '' : answerText.value.trim(),
    transcript: skipped ? '' : speechTranscript.value,
    skipped,
    elapsedSeconds: ANSWERING_SECONDS - timeLeft.value,
    speechMetrics: skipped ? undefined : speechMetrics.value
  });
  currentIndex.value += 1;
  resetAnswerState();
  if (currentIndex.value >= questions.value.length) await finishInterview();
  else startTimer('thinking', THINKING_SECONDS);
}

function resetAnswerState() {
  answerText.value = '';
  speechTranscript.value = '';
  speechMetrics.value = undefined;
  speechError.value = '';
}

async function toggleSpeech() {
  if (isRecording.value) await stopSpeech();
  else await startSpeech();
}

async function startSpeech() {
  isSpeechBusy.value = true;
  speechError.value = '';
  try {
    const granted = await speechRecognitionAdapter.requestPermissions();
    if (!granted) {
      speechError.value = '未获得麦克风或语音识别权限';
      return;
    }
    await speechRecognitionAdapter.start();
    isRecording.value = true;
  } catch (error) {
    speechError.value = error instanceof Error ? error.message : '语音识别启动失败';
  } finally {
    isSpeechBusy.value = false;
  }
}

async function stopSpeech() {
  isSpeechBusy.value = true;
  speechError.value = '';
  try {
    const result = await speechRecognitionAdapter.stop();
    speechTranscript.value = result.transcript;
    speechMetrics.value = result.metrics;
    if (result.transcript) answerText.value = result.transcript;
  } catch (error) {
    speechError.value = error instanceof Error ? error.message : '语音识别结束失败';
  } finally {
    isRecording.value = false;
    isSpeechBusy.value = false;
  }
}

async function finishInterview() {
  stopTimer();
  resultSession.value = await interviewRepository.saveSession({
    interviewType: 'structured',
    difficulty: difficulty.value,
    questionTypes: questionTypes.value,
    answers: answers.value
  });
  stage.value = 'result';
  clearDraft();
  await loadStats();
  await enqueueAiReview();
}

async function enqueueAiReview() {
  if (!resultSession.value || isReviewing.value) return;
  isReviewing.value = true;
  try {
    const result = await interviewRepository.enqueueAiReview(resultSession.value);
    reviewTaskId.value = result.task.id;
    visibleReviewTask.value = result.task;
    resultSession.value = { ...resultSession.value, reviewStatus: 'pending', reviewTaskId: result.task.id };
  } catch {
    resultSession.value = await interviewRepository.updateReviewState(resultSession.value.id, 'failed') ?? resultSession.value;
  } finally {
    isReviewing.value = false;
  }
}

async function cancelAiReview() {
  if (!reviewTaskId.value) return;
  const runtime = await initializeTutorRuntime();
  await runtime.cancelAgentRun.execute({
    agentRunId: reviewTaskId.value as Parameters<typeof runtime.cancelAgentRun.execute>[0]['agentRunId'],
    reason: 'user_cancelled_interview_review'
  });
  await refreshReviewTask();
}

async function refreshReviewTask() {
  if (!reviewTaskId.value) return;
  const runtime = await initializeTutorRuntime();
  const task = (await runtime.getAgentRunViews.execute({ limit: 50 })).find((item) => item.id === reviewTaskId.value);
  visibleReviewTask.value = task;
  if (!task || !resultSession.value) return;
  if (task.status === 'completed') {
    const updated = await interviewRepository.getSession(resultSession.value.id);
    if (updated) resultSession.value = updated;
    visibleReviewTask.value = undefined;
    reviewTaskId.value = '';
    await loadStats();
  } else if ((task.status === 'failed' || task.status === 'cancelled') && resultSession.value.reviewStatus !== 'failed') {
    resultSession.value = await interviewRepository.updateReviewState(resultSession.value.id, 'failed', task.id) ?? resultSession.value;
  }
}

function openSession(session: InterviewSession) {
  resultSession.value = session;
  stage.value = 'result';
  reviewTaskId.value = session.reviewTaskId || '';
  visibleReviewTask.value = undefined;
  if (reviewTaskId.value) void refreshReviewTask();
}

async function backToSetup() {
  stage.value = 'setup';
  resultSession.value = null;
  visibleReviewTask.value = undefined;
  reviewTaskId.value = '';
  clearDraft();
  await loadStats();
}

function requestLeave() {
  if (stage.value === 'session') showLeaveConfirm.value = true;
  else goBackOrHome(router);
}

function confirmLeave() {
  saveDraftNow();
  showLeaveConfirm.value = false;
  goBackOrHome(router);
}

function draftSnapshot(): InterviewDraft | null {
  if (stage.value !== 'session' || !questions.value.length) return null;
  return {
    stage: 'session',
    difficulty: difficulty.value,
    questionTypes: questionTypes.value,
    questions: questions.value,
    currentIndex: currentIndex.value,
    answerText: answerText.value,
    speechTranscript: speechTranscript.value,
    speechMetrics: speechMetrics.value,
    answers: answers.value,
    timerPhase: timerPhase.value,
    timeLeft: Math.max(0, Math.ceil((timerDeadline.value - Date.now()) / 1000)),
    savedAt: Date.now()
  };
}

function saveDraftNow() {
  clearDraftTimer();
  const draft = draftSnapshot();
  if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function scheduleDraftSave() {
  if (stage.value !== 'session') return;
  clearDraftTimer();
  draftSaveTimer.value = window.setTimeout(saveDraftNow, 300);
}

function clearDraftTimer() {
  if (draftSaveTimer.value !== null) window.clearTimeout(draftSaveTimer.value);
  draftSaveTimer.value = null;
}

function clearDraft() {
  clearDraftTimer();
  localStorage.removeItem(DRAFT_KEY);
}

function restoreDraft() {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return;
  try {
    const draft = JSON.parse(raw) as InterviewDraft;
    if (draft.stage !== 'session' || !Array.isArray(draft.questions) || !draft.questions.length) return;
    difficulty.value = draft.difficulty;
    questionTypes.value = draft.questionTypes;
    questions.value = draft.questions;
    currentIndex.value = Math.min(draft.currentIndex, draft.questions.length - 1);
    answerText.value = draft.answerText || '';
    speechTranscript.value = draft.speechTranscript || '';
    speechMetrics.value = draft.speechMetrics;
    answers.value = draft.answers || [];
    stage.value = 'session';
    const elapsed = Math.max(0, Math.floor((Date.now() - draft.savedAt) / 1000));
    startTimer(draft.timerPhase || 'thinking', Math.max(0, draft.timeLeft - elapsed));
  } catch {
    clearDraft();
  }
}

function handleVisibilityChange() {
  if (document.hidden) saveDraftNow();
  else void tickTimer();
}
</script>

<style scoped src="./InterviewView.css"></style>
