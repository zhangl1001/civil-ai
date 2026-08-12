<template>
  <div class="interview-page app-page">
    <header class="app-page-header">
      <div class="title-row">
        <button class="icon-button" type="button" @click="goBack"><ArrowLeftIcon /></button>
        <div>
          <h3>面试模拟</h3>
          <span>结构化表达 · 本地评分</span>
        </div>
        <span class="header-spacer" aria-hidden="true"></span>
      </div>
    </header>

    <main class="app-page-scroll">
      <template v-if="stage === 'setup'">
        <section class="hero app-card">
          <div class="hero-title"><MicIcon /><strong>面试模拟</strong></div>
          <p>结构化面试 · 情境训练 · 本地复盘</p>
          <div class="stats-row">
            <div><strong>{{ stats.totalSessions }}</strong><span>练习次数</span></div>
            <div><strong>{{ stats.averageScore ? `${stats.averageScore}` : '-' }}</strong><span>平均得分</span></div>
          </div>
        </section>

        <section class="setup-section">
          <div class="section-title"><strong>面试类型</strong></div>
          <div class="type-grid">
            <button type="button" :class="{ active: interviewType === 'structured' }" @click="interviewType = 'structured'">
              <UserIcon /><strong>结构化面试</strong><span>单人逐题作答</span>
            </button>
            <button type="button" :class="{ active: interviewType === 'group' }" @click="interviewType = 'group'">
              <UsersIcon /><strong>无领导小组</strong><span>讨论情境模拟</span>
            </button>
          </div>
        </section>

        <section class="setup-section">
          <div class="section-title">
            <strong>题型选择</strong>
            <button type="button" @click="toggleAllTypes">全选/取消</button>
          </div>
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
          <div class="section-title"><strong>难度设定</strong></div>
          <div class="difficulty">
            <button type="button" :class="{ active: difficulty === 'easy' }" @click="difficulty = 'easy'">基础</button>
            <button type="button" :class="{ active: difficulty === 'medium' }" @click="difficulty = 'medium'">标准</button>
            <button type="button" :class="{ active: difficulty === 'hard' }" @click="difficulty = 'hard'">进阶</button>
          </div>
        </section>

        <button class="primary-button start-button" type="button" @click="startInterview">
          <PlayIcon /> 开始模拟
        </button>

        <section class="history">
          <div class="section-title"><strong>练习记录</strong><span>最近 5 条</span></div>
          <AppStateView v-if="!history.length" compact title="暂无面试练习记录" description="完成一次模拟后会在这里沉淀复盘记录。" />
          <article v-for="session in history" :key="session.id" class="history-row app-card">
            <MicIcon />
            <div><strong>{{ session.date }}</strong><span>{{ session.questionCount }} 题 · {{ typeText(session.interviewType) }}</span></div>
            <em>{{ session.score ? `${session.score.total}/${maxScore(session)}` : '待复盘' }}</em>
          </article>
        </section>
      </template>

      <template v-else-if="stage === 'session' && currentQuestion">
        <section class="timer-card app-card">
          <strong :class="{ warning: timeLeft <= 60, danger: timeLeft <= 30 }">{{ timerText }}</strong>
          <span>思考时间</span>
        </section>

        <section class="question-card app-card">
          <div><span>第 {{ currentIndex + 1 }} 题 / 共 {{ questions.length }} 题</span><em>{{ currentQuestion.type }}</em></div>
          <h4>{{ currentQuestion.text }}</h4>
          <p>提示：{{ currentQuestion.hint }}</p>
        </section>

        <div class="speech-panel app-card">
          <button type="button" :class="{ recording: isRecording }" :disabled="!speechAvailable || isSpeechBusy" @click="toggleSpeech">
            <MicIcon />
            {{ speechButtonText }}
          </button>
          <span>{{ speechHint }}</span>
        </div>

        <textarea v-model="answerText" class="answer-input" placeholder="在此输入你的作答，或使用语音识别转写..." />

        <div class="session-actions">
          <button type="button" class="secondary-button" @click="skipQuestion"><SkipForwardIcon /> 跳过</button>
          <button type="button" class="primary-button" @click="submitAnswer"><SendIcon /> 提交作答</button>
        </div>
      </template>

      <template v-else-if="stage === 'result' && resultSession">
        <section class="result-hero app-card">
          <strong>{{ resultSession.score ? `${resultSession.score.total}/${maxScore(resultSession)}` : '--' }}</strong>
          <span>综合评分</span>
        </section>

        <section class="score-card app-card">
          <div v-for="item in scoreRows" :key="item.label" class="score-row">
            <span>{{ item.label }}</span>
            <div><i :style="{ width: `${item.value * 20}%` }"></i></div>
            <em>{{ item.value }}/5</em>
          </div>
          <p v-if="resultSession.aiFeedback">{{ resultSession.aiFeedback }}</p>
        </section>

        <AiTaskPendingState
          v-if="visibleReviewTask && visibleReviewTask.status !== 'completed'"
          :task="visibleReviewTask"
          title="AI 正在做面试深度点评"
          :description="visibleReviewTask.message || visibleReviewTask.detail || '会结合逐题作答、表达结构和语音指标生成复盘。'"
          ready-action-label="重新点评"
          retry-action-label="重新点评"
          @start="enqueueAiReview"
          @retry="enqueueAiReview"
          @cancel="cancelAiReview"
        />

        <section v-else class="ai-review-card app-card">
          <div class="section-title">
            <strong>AI 深度点评</strong>
            <button type="button" :disabled="isReviewing" @click="enqueueAiReview">
              <SparklesIcon />
              {{ resultSession.aiFeedback ? '重新点评' : '生成点评' }}
            </button>
          </div>
          <MarkdownContent v-if="resultSession.aiFeedback" class="ai-review-content" :content="resultSession.aiFeedback" />
          <p v-else class="ai-review-empty">生成后会给出逐题复盘、表达建议和下一次训练重点。</p>
        </section>

        <section class="review-list">
          <div class="section-title"><strong>作答回顾</strong></div>
          <article v-for="(item, index) in resultSession.answers" :key="item.question.id" class="review-card app-card">
            <strong>第 {{ index + 1 }} 题：{{ item.question.text }}</strong>
            <p :class="{ skipped: item.skipped }">{{ item.skipped ? '已跳过' : item.answer }}</p>
            <span v-if="item.speechMetrics" class="speech-metrics">
              {{ item.speechMetrics.durationSeconds }} 秒 · {{ item.speechMetrics.wordsPerMinute }} 字/分 · 口头语 {{ item.speechMetrics.fillerCount }}
            </span>
            <em>{{ item.completeness?.status === 'substantive' ? '已详答' : item.skipped ? '已跳过' : '简答' }}</em>
          </article>
        </section>

        <div class="session-actions">
          <button type="button" class="secondary-button" @click="backToSetup"><ArrowLeftIcon /> 返回</button>
          <button type="button" class="primary-button" @click="startInterview"><RotateCcwIcon /> 再来一次</button>
        </div>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  ArrowLeftIcon,
  MicIcon,
  PlayIcon,
  RotateCcwIcon,
  SendIcon,
  SkipForwardIcon,
  SparklesIcon,
  UserIcon,
  UsersIcon
} from 'lucide-vue-next';
import type { AgentRunView } from '@/modules/agent/public';
import { initializeTutorRuntime } from '@/composition-root/public';
import type { InterviewAnswer, InterviewDifficulty, InterviewQuestion, InterviewQuestionType, InterviewSession, InterviewStats, InterviewType } from '@/domain/interview';
import AiTaskPendingState from '@/components/AiTaskPendingState.vue';
import MarkdownContent from '@/components/MarkdownContent.vue';
import { AppStateView } from '@/capabilities/design-system/public';
import { goBackOrHome } from '@/router/navigation';
import { speechRecognitionAdapter } from '@/platform/SpeechRecognitionAdapter';
import { INTERVIEW_QUESTION_TYPES, interviewRepository } from '@/services/InterviewRepository';

const router = useRouter();
const DRAFT_KEY = 'interview-session-draft';
const questionTypeOptions = INTERVIEW_QUESTION_TYPES;
const stage = ref<'setup' | 'session' | 'result'>('setup');
const interviewType = ref<InterviewType>('structured');
const difficulty = ref<InterviewDifficulty>('medium');
const questionTypes = ref<InterviewQuestionType[]>([...questionTypeOptions]);
const questions = ref<InterviewQuestion[]>([]);
const currentIndex = ref(0);
const answerText = ref('');
const speechTranscript = ref('');
const speechMetrics = ref<InterviewAnswer['speechMetrics'] | undefined>(undefined);
const speechAvailable = ref(false);
const isRecording = ref(false);
const isSpeechBusy = ref(false);
const speechError = ref('');
const answers = ref<InterviewAnswer[]>([]);
const timeLeft = ref(180);
const timerId = ref<number | null>(null);
const history = ref<InterviewSession[]>([]);
const stats = ref<InterviewStats>({ totalSessions: 0, averageScore: 0 });
const resultSession = ref<InterviewSession | null>(null);
const draftSaveTimer = ref<number | null>(null);
const visibleReviewTask = ref<AgentRunView | undefined>();
const reviewTaskId = ref('');
const isReviewing = ref(false);
let reviewPollId: number | null = null;

interface InterviewDraft {
  stage: 'session';
  interviewType: InterviewType;
  difficulty: InterviewDifficulty;
  questionTypes: InterviewQuestionType[];
  questions: InterviewQuestion[];
  currentIndex: number;
  answerText: string;
  speechTranscript: string;
  speechMetrics?: InterviewAnswer['speechMetrics'];
  answers: InterviewAnswer[];
  timeLeft: number;
  savedAt: number;
}

const currentQuestion = computed(() => questions.value[currentIndex.value] || null);
const timerText = computed(() => `${String(Math.floor(timeLeft.value / 60)).padStart(2, '0')}:${String(timeLeft.value % 60).padStart(2, '0')}`);
const scoreRows = computed(() => resultSession.value?.score?.dimensions.map((dim) => ({ label: dim.name, value: dim.score })) || []);
const speechButtonText = computed(() => {
  if (!speechAvailable.value) return '语音不可用';
  if (isSpeechBusy.value) return '处理中...';
  return isRecording.value ? '停止识别' : '语音作答';
});
const speechHint = computed(() => {
  if (speechError.value) return speechError.value;
  if (!speechAvailable.value) return '当前环境仅支持文本输入';
  if (isRecording.value) return '正在识别，结束后自动转写到作答区';
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
  if (reviewPollId !== null) window.clearInterval(reviewPollId);
  window.removeEventListener('beforeunload', saveDraftNow);
  clearDraftTimer();
  stopTimer();
  if (isRecording.value) void speechRecognitionAdapter.stop().catch(() => undefined);
});

watch(answerText, () => scheduleDraftSave());
watch([stage, currentIndex, questions, answers], () => scheduleDraftSave(), { deep: true });

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

function startInterview() {
  clearDraft();
  questions.value = interviewRepository.pickQuestions(questionTypes.value, 3);
  currentIndex.value = 0;
  answers.value = [];
  resultSession.value = null;
  answerText.value = '';
  speechTranscript.value = '';
  speechMetrics.value = undefined;
  speechError.value = '';
  stage.value = 'session';
  resetTimer();
  saveDraftNow();
}

function resetTimer() {
  startTimer(180);
}

function startTimer(seconds: number) {
  stopTimer();
  timeLeft.value = Math.max(0, seconds);
  timerId.value = window.setInterval(() => {
    if (timeLeft.value > 0) timeLeft.value -= 1;
  }, 1000);
}

function stopTimer() {
  if (timerId.value !== null) {
    window.clearInterval(timerId.value);
    timerId.value = null;
  }
}

function submitAnswer() {
  if (!answerText.value.trim()) return;
  pushAnswer(false);
}

function skipQuestion() {
  pushAnswer(true);
}

async function pushAnswer(skipped: boolean) {
  if (!currentQuestion.value) return;
  if (isRecording.value) await stopSpeech();
  answers.value.push({
    question: currentQuestion.value,
    answer: skipped ? '' : answerText.value.trim(),
    transcript: skipped ? '' : speechTranscript.value,
    skipped,
    elapsedSeconds: 180 - timeLeft.value,
    speechMetrics: skipped ? undefined : speechMetrics.value
  });
  answerText.value = '';
  speechTranscript.value = '';
  speechMetrics.value = undefined;
  currentIndex.value += 1;
  saveDraftNow();
  if (currentIndex.value >= questions.value.length) {
    await finishInterview();
  } else {
    resetTimer();
  }
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
    interviewType: interviewType.value,
    difficulty: difficulty.value,
    questionTypes: questionTypes.value,
    answers: answers.value
  });
  stage.value = 'result';
  visibleReviewTask.value = undefined;
  reviewTaskId.value = '';
  clearDraft();
  await loadStats();
}

async function enqueueAiReview() {
  if (!resultSession.value || isReviewing.value) return;
  isReviewing.value = true;
  try {
    const result = await interviewRepository.enqueueAiReview(resultSession.value);
    reviewTaskId.value = result.task.id;
    visibleReviewTask.value = result.task;
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
  const task = (await runtime.getAgentRunViews.execute({ limit: 50 }))
    .find((item) => item.id === reviewTaskId.value);
  visibleReviewTask.value = task;
  if (task?.status === 'completed' && resultSession.value) {
    const updated = await interviewRepository.getSession(resultSession.value.id);
    if (updated) resultSession.value = updated;
    visibleReviewTask.value = undefined;
    reviewTaskId.value = '';
    await loadStats();
  }
}

async function backToSetup() {
  stage.value = 'setup';
  clearDraft();
  await loadStats();
}

function goBack() {
  goBackOrHome(router);
}

function typeText(type: InterviewType): string {
  return type === 'group' ? '无领导' : '结构化';
}

function maxScore(session: InterviewSession): number {
  const hasFluency = session.score?.dimensions.some((d) => d.code === 'fluency');
  return hasFluency ? 20 : 15;
}

function draftSnapshot(): InterviewDraft | null {
  if (stage.value !== 'session' || !questions.value.length) return null;
  return {
    stage: 'session',
    interviewType: interviewType.value,
    difficulty: difficulty.value,
    questionTypes: questionTypes.value,
    questions: questions.value,
    currentIndex: currentIndex.value,
    answerText: answerText.value,
    speechTranscript: speechTranscript.value,
    speechMetrics: speechMetrics.value,
    answers: answers.value,
    timeLeft: timeLeft.value,
    savedAt: Date.now()
  };
}

function saveDraftNow() {
  clearDraftTimer();
  const draft = draftSnapshot();
  if (!draft) return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function scheduleDraftSave() {
  if (stage.value !== 'session') return;
  clearDraftTimer();
  draftSaveTimer.value = window.setTimeout(saveDraftNow, 300);
}

function clearDraftTimer() {
  if (draftSaveTimer.value !== null) {
    window.clearTimeout(draftSaveTimer.value);
    draftSaveTimer.value = null;
  }
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
    interviewType.value = draft.interviewType;
    difficulty.value = draft.difficulty;
    questionTypes.value = draft.questionTypes;
    questions.value = draft.questions;
    currentIndex.value = Math.min(draft.currentIndex, draft.questions.length - 1);
    answerText.value = draft.answerText || '';
    speechTranscript.value = draft.speechTranscript || '';
    speechMetrics.value = draft.speechMetrics;
    answers.value = draft.answers || [];
    resultSession.value = null;
    stage.value = 'session';
    startTimer(draft.timeLeft || 180);
  } catch {
    clearDraft();
  }
}

function handleVisibilityChange() {
  if (document.hidden) saveDraftNow();
}
</script>

<style scoped>
.title-row,
.hero-title,
.stats-row,
.section-title,
.history-row,
.question-card div,
.session-actions,
.score-row {
  display: flex;
  align-items: center;
}
.title-row { justify-content: space-between; gap: 10px; }
.header-spacer { width: 36px; height: 36px; flex: 0 0 auto; }
.title-row > div { text-align: center; min-width: 0; }
h3 { margin: 0; font-size: var(--type-size-section-title); }
.title-row span { display: block; margin-top: 2px; color: var(--text-secondary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); }
.icon-button svg { width: 18px; height: 18px; }
.hero { margin: 16px; padding: 18px; text-align: center; }
.hero-title { justify-content: center; gap: 8px; color: #7e57c2; }
.hero-title svg { width: 28px; height: 28px; }
.hero-title strong { font-size: var(--type-size-display); }
.hero p { margin: 6px 0 14px; color: var(--text-secondary-color); font-size: var(--type-size-secondary); }
.stats-row { justify-content: center; gap: 38px; }
.stats-row strong, .stats-row span { display: block; }
.stats-row strong { color: #7e57c2; font-size: var(--type-size-page-title); }
.stats-row span { color: var(--text-secondary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); }
.setup-section, .history { margin: 16px; }
.section-title { justify-content: space-between; margin-bottom: 9px; }
.section-title strong { font-size: var(--type-size-body-large); }
.section-title span, .section-title button { color: var(--text-secondary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); }
.section-title button { border: none; background: transparent; }
.type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.type-grid button { min-height: 112px; border: 1px solid rgba(var(--color-ink-rgb), .08); border-radius: 14px; background: rgba(255,255,255,.76); font: inherit; }
.type-grid button.active { border-color: rgba(126,87,194,.35); background: rgba(126,87,194,.11); color: #6f42c1; }
.type-grid svg { width: 24px; height: 24px; }
.type-grid strong, .type-grid span { display: block; }
.type-grid strong { margin-top: 8px; font-size: var(--type-size-body); }
.type-grid span { margin-top: 4px; color: var(--text-secondary-color); font-size: var(--type-size-micro); }
.chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
.chip-row button, .difficulty button { height: 34px; border: 1px solid rgba(var(--color-ink-rgb), .08); border-radius: 17px; padding: 0 13px; background: rgba(255,255,255,.76); color: var(--text-secondary-color); font: inherit; font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); }
.chip-row button.active, .difficulty button.active { border-color: rgba(126,87,194,.35); background: rgba(126,87,194,.11); color: #6f42c1; }
.difficulty { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.start-button { margin: 4px 16px 16px; }
.history-row { gap: 10px; margin-top: 8px; padding: 12px; }
.history-row svg { width: 20px; height: 20px; color: #7e57c2; }
.history-row div { flex: 1; min-width: 0; }
.history-row strong, .history-row span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-row strong { font-size: var(--type-size-secondary); }
.history-row span { margin-top: 2px; color: var(--text-secondary-color); font-size: var(--type-size-micro); }
.history-row em { color: #7e57c2; font-style: normal; font-weight: var(--type-weight-semibold); }
.timer-card { margin: 16px; padding: 18px; text-align: center; }
.timer-card strong { display: block; font-size: var(--type-size-metric-large); font-variant-numeric: tabular-nums; }
.timer-card strong.warning { color: #ef6c00; }
.timer-card strong.danger { color: #d93025; }
.timer-card span { color: var(--text-secondary-color); font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); }
.question-card { margin: 16px; padding: 16px; }
.question-card div { gap: 8px; }
.question-card span { color: #6f42c1; font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); }
.question-card em { border-radius: 12px; padding: 2px 8px; background: rgba(126,87,194,.12); color: #6f42c1; font-size: var(--type-size-micro); font-style: normal; font-weight: var(--type-weight-semibold); }
.question-card h4 { margin: 10px 0 8px; font-size: var(--type-size-control); line-height: 1.65; }
.question-card p { margin: 0; color: var(--text-secondary-color); font-size: var(--type-size-caption); line-height: 1.6; }
.answer-input { width: calc(100% - 32px); min-height: 150px; box-sizing: border-box; margin: 0 16px 16px; border: 1px solid rgba(var(--color-ink-rgb), .1); border-radius: 14px; padding: 12px; background: rgba(255,255,255,.82); color: var(--text-color); font: inherit; font-size: var(--type-size-body); resize: vertical; }
.speech-panel { margin: 0 16px 12px; padding: 10px; display: flex; align-items: center; gap: 10px; }
.speech-panel button { flex-shrink: 0; height: 34px; border: none; border-radius: 10px; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; background: rgba(126,87,194,.12); color: #6f42c1; font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); }
.speech-panel button.recording { background: rgba(217,48,37,.12); color: #d93025; }
.speech-panel button:disabled { opacity: .55; }
.speech-panel button svg { width: 15px; height: 15px; }
.speech-panel span { min-width: 0; color: var(--text-secondary-color); font-size: var(--type-size-micro); line-height: 1.45; }
.session-actions { gap: 8px; margin: 0 16px 18px; }
.session-actions button { flex: 1; }
.secondary-button { height: 44px; border: none; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: rgba(var(--color-ink-rgb), .07); color: var(--text-secondary-color); font-size: var(--type-size-body); font-weight: var(--type-weight-semibold); }
.primary-button svg, .secondary-button svg { width: 16px; height: 16px; }
.result-hero { margin: 16px; padding: 22px; text-align: center; }
.result-hero strong { display: block; color: #7e57c2; font-size: var(--type-size-metric); }
.result-hero span { color: var(--text-secondary-color); font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); }
.score-card { margin: 16px; padding: 15px; }
.score-row { gap: 10px; margin-bottom: 10px; }
.score-row span { width: 42px; color: var(--text-secondary-color); font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); }
.score-row div { flex: 1; height: 12px; border-radius: 6px; overflow: hidden; background: rgba(var(--color-ink-rgb), .08); }
.score-row i { display: block; height: 100%; border-radius: 6px; background: #7e57c2; }
.score-row em { width: 38px; color: #7e57c2; text-align: right; font-style: normal; font-weight: var(--type-weight-semibold); }
.score-card p { margin: 8px 0 0; color: var(--text-secondary-color); font-size: var(--type-size-caption); line-height: 1.6; }
.ai-review-card { margin: 16px; padding: 14px; }
.ai-review-card .section-title button {
  height: 30px;
  border: none;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  background: rgba(126,87,194,.12);
  color: #6f42c1;
  font-family: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.ai-review-card .section-title button:disabled { opacity: .55; }
.ai-review-card .section-title button svg { width: 14px; height: 14px; }
.ai-review-content,
.ai-review-empty {
  margin: 10px 0 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  line-height: 1.7;
  white-space: pre-wrap;
}
.ai-review-empty {
  padding: 12px;
  border-radius: 12px;
  background: rgba(var(--color-ink-rgb), .045);
}
.review-list { margin: 16px; }
.review-card { margin-top: 9px; padding: 13px; }
.review-card strong { display: block; font-size: var(--type-size-secondary); line-height: 1.5; }
.review-card p { margin: 7px 0; color: var(--text-secondary-color); font-size: var(--type-size-caption); line-height: 1.6; white-space: pre-line; }
.review-card p.skipped { color: #ef6c00; }
.speech-metrics { display: block; margin-bottom: 6px; color: var(--text-secondary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); }
.review-card em { color: #7e57c2; font-style: normal; font-weight: var(--type-weight-semibold); }
</style>
