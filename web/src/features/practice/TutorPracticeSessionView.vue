<template>
  <div class="tutor-session app-page">
    <PageHeader :title="practiceCategory">
      <template #meta>
        <div class="session-header-meta">
          <span>{{ sessionMeta }}</span>
          <span v-if="activeTab === 'questions' && !submitted" class="session-timer" :class="{ warning: remainingSeconds <= 60 }">
            <Clock3Icon />{{ countdownLabel }}
          </span>
        </div>
      </template>
      <template #actions>
        <button class="answer-card-button" type="button" title="答题卡" aria-label="答题卡" :disabled="submitting" @click="showAnswerCard = true"><ListChecksIcon /></button>
        <HeaderMoreMenu title="题目操作" subtitle="当前题目与配套内容">
          <button v-if="question && submitted" class="menu-row" type="button" :disabled="askingAi" @click="askAIAboutCurrentQuestion">
            <MessageCircleMoreIcon />{{ askingAi ? '正在打开 AI' : 'AI 深度讲解' }}
          </button>
          <button v-if="lectureDocument" class="menu-row" type="button" @click="activeTab = 'lecture'">
            <BookOpenIcon />查看配套讲义
          </button>
        </HeaderMoreMenu>
      </template>
    </PageHeader>

    <nav v-if="bundle && lectureDocument" class="session-tabs" aria-label="学习内容切换">
      <button type="button" :disabled="submitting" :class="{ active: activeTab === 'lecture' }" @click="activeTab = 'lecture'">讲义</button>
      <button type="button" :disabled="submitting" :class="{ active: activeTab === 'questions' }" @click="activeTab = 'questions'">题目</button>
    </nav>

    <main v-if="activeTab === 'lecture' && lectureDocument" class="app-page-scroll session-scroll lecture-scroll">
      <LectureContent :document="lectureDocument.content" />
    </main>
    <main
      v-else-if="question"
      ref="questionScroll"
      :class="['app-page-scroll', 'session-scroll', `question-presentation-${questionPresentation}`]"
      @touchstart.passive="handleQuestionTouchStart"
      @touchmove="handleQuestionTouchMove"
      @touchend="handleQuestionTouchEnd"
      @touchcancel="resetQuestionTouch"
    >
      <p v-if="sourceMetadata" class="question-source-meta">
        <span>{{ questionOriginLabel(sourceMetadata.sourceType) }}</span>
        {{ questionSourceTitle(sourceMetadata) }}
      </p>
      <p v-if="isSharedMaterialQuestion" class="material-group-meta">
        共用材料 · 第 {{ materialGroupPosition }} / {{ materialGroupSize }} 小题
      </p>
      <QuestionContentTemplate
        :question="question.content"
        :presentation="questionPresentation"
        :selected-option-id="answers[question.id]"
        :reveal-result="submitted"
        :readonly-mode="submitted"
        :disabled="submitting"
        :show-explanation="submitted"
        @select="selectOption"
      >
        <template #diagnosis>
      <section v-if="submitted" class="diagnosis" :class="{ pending: diagnosing }">
        <div class="diagnosis-heading">
          <strong>错因分析</strong>
          <button
            v-if="isIncorrect(question.id)"
            class="ask-ai-button"
            type="button"
            :disabled="askingAi"
            @click="askAIAboutCurrentQuestion"
          >
            <MessageCircleMoreIcon />{{ askingAi ? '正在打开' : '问 AI 讲透' }}
          </button>
        </div>
        <template v-if="effectiveDiagnosisFor(question.id)">
          <ErrorDiagnosisInsight
            v-if="hasSpecificDiagnosisFor(question.id) || !diagnosing"
            :cause-code="effectiveDiagnosisFor(question.id)!.causeCode"
            :cause-label="diagnosisLabel(question.id)"
            :detail="diagnosisDetail(question.id)"
            :dimensions="effectiveDiagnosisFor(question.id)!.record.dimensions"
            :correction-plan="effectiveDiagnosisFor(question.id)!.record.correctionPlan"
          />
          <p v-else>AI 正在结合题目、选项和本次作答进一步分析。</p>
          <small v-if="hasSpecificDiagnosisFor(question.id) && effectiveDiagnosisFor(question.id)?.confirmationStatus === 'confirmed'">你已确认这个错因</small>
          <small v-else-if="hasSpecificDiagnosisFor(question.id) && effectiveDiagnosisFor(question.id)?.confirmationStatus === 'corrected'">已按你的反馈修正</small>
          <div v-else-if="hasSpecificDiagnosisFor(question.id) && isIncorrect(question.id) && !diagnosing" class="diagnosis-actions">
            <button type="button" :disabled="isConfirming" @click="confirmDiagnosis(question.id)">分析准确</button>
            <button type="button" :disabled="isConfirming" @click="openCorrection(question.id)">不是这个原因</button>
          </div>
        </template>
        <p v-else>{{ diagnosing ? '正在结合你的作答过程分析错因...' : '本题作答正确，继续保持。' }}</p>
      </section>
        </template>
      </QuestionContentTemplate>
      <p v-if="error" class="session-error">{{ error }}</p>
    </main>
    <main v-else class="session-empty">{{ error || '正在读取题目...' }}</main>

    <footer v-if="bundle && activeTab === 'questions' && (!isSharedMaterialQuestion || index === bundle.questions.length - 1)" class="session-actions">
      <button v-if="!isSharedMaterialQuestion" :disabled="submitting || index === 0" @click="changeQuestion(index - 1)">上一题</button>
      <button v-if="!isSharedMaterialQuestion && index < bundle.questions.length - 1" :disabled="submitting || (!submitted && !answers[question?.id || ''])" @click="changeQuestion(index + 1)">下一题</button>
      <button v-else-if="submitted" @click="showAnswerCard = true">查看答题卡</button>
      <button v-else :disabled="submitting" @click="requestSubmit">{{ submitting ? '提交中...' : '交卷' }}</button>
    </footer>

    <CenterDialog v-model="showAnswerCard" title="答题卡" subtitle="点击题号可直接跳转" variant="content">
      <QuestionAnswerCard
        :questions="cardQuestions"
        :current-index="index"
        :answers="answers"
        :submitted="submitted"
        @select="goTo"
      />
    </CenterDialog>
    <ConfirmDialog v-model="showSubmitConfirm" title="确认交卷？" :description="unansweredCount ? `还有 ${unansweredCount} 题未作答，提交后将进入批改。` : '本组题目已全部作答，提交后将进入批改。'" confirm-text="确认交卷" @confirm="submit" />
    <CenterDialog v-model="showCorrectionDialog" title="修正错因" subtitle="你的反馈会进入后续教学决策" variant="form">
      <div class="correction-form">
        <span>更符合实际的原因</span>
        <div class="cause-options">
          <button
            v-for="item in causeOptions"
            :key="item.code"
            type="button"
            :class="{ active: correctedCauseCode === item.code }"
            @click="correctedCauseCode = item.code"
          >
            {{ item.label }}
          </button>
        </div>
        <label>
          <span>补充说明</span>
          <textarea v-model="correctedDetail" rows="3" placeholder="例如：我能识别题型，但比较两个选项的削弱力度时判断错了。"></textarea>
        </label>
        <button class="correction-submit" type="button" :disabled="isConfirming || !correctedCauseCode || !correctedDetail.trim()" @click="submitCorrection">
          保存修正
        </button>
      </div>
    </CenterDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { BookOpenIcon, Clock3Icon, ListChecksIcon, MessageCircleMoreIcon } from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
import CenterDialog from '@/components/layout/CenterDialog.vue';
import ConfirmDialog from '@/components/layout/ConfirmDialog.vue';
import LectureContent from '@/components/content/LectureContent.vue';
import HeaderMoreMenu from '@/components/layout/HeaderMoreMenu.vue';
import QuestionAnswerCard, { type AnswerCardQuestionItem } from '@/components/question/QuestionAnswerCard.vue';
import QuestionContentTemplate from '@/components/question/QuestionContentTemplate.vue';
import ErrorDiagnosisInsight from '@/components/learning/ErrorDiagnosisInsight.vue';
import { agentWorkerCoordinator, initializeTutorRuntime } from '@/composition-root/public';
import { objectiveSubmissionRecoveryCoordinator } from '@/composition-root/evidence/ObjectiveSubmissionRecoveryCoordinator';
import { practiceModuleLabel } from '@/domain/labels';
import type { AssessmentRole } from '@/kernel/public';
import {
  contentDocumentText,
  resolveQuestionPresentation,
  questionOriginLabel,
  questionSourceTitle,
  type CommittedQuestionSetBundle,
  type QuestionSetSourceSummary
} from '@/modules/content/public';
import {
  ErrorCauseCode,
  ErrorDiagnosisConfirmationAction,
  errorCauseLabel,
  type ErrorDiagnosisCurrentProjection,
  type ErrorDiagnosisRecord,
  type ObjectiveSessionReview
} from '@/modules/evidence/public';
import { useAIChatStore } from '@/stores/aiChat';
import { PracticeSessionFeature } from './PracticeSessionFeature';
import {
  PracticeSessionDraftService,
  type PracticeSessionDraftIdentity
} from './PracticeSessionDraftService';
import { resolveQuestionSwipe } from './QuestionSwipeNavigation';

const route = useRoute();
const chat = useAIChatStore();
const bundle = ref<CommittedQuestionSetBundle>();
const manifestSections = ref<Array<{
  bundle: CommittedQuestionSetBundle;
  learningThreadId: string;
  module: string;
}>>([]);
const error = ref(''); const index = ref(0); const answers = ref<Record<string, string>>({});
const activeTab = ref<'lecture' | 'questions'>('questions');
const submitted = ref(false); const submitting = ref(false); const showAnswerCard = ref(false); const showSubmitConfirm = ref(false);
const diagnosing = ref(false); const review = ref<ObjectiveSessionReview>();
const reviewSessionIds = ref<string[]>([]);
const isConfirming = ref(false); const showCorrectionDialog = ref(false); const correctionTarget = ref<ErrorDiagnosisRecord>();
const correctedCauseCode = ref(''); const correctedDetail = ref('');
const elapsedByQuestion = ref<Record<string, number>>({}); const answerChanges = ref<Record<string, number>>({});
const capabilityName = ref('');
const assessmentRoleOverride = ref<AssessmentRole>();
const sourceMetadata = ref<QuestionSetSourceSummary>();
const askingAi = ref(false);
const remainingSeconds = ref(0);
const questionScroll = ref<HTMLElement>();
let sessionFeaturePromise: Promise<PracticeSessionFeature> | undefined;
const draftService = new PracticeSessionDraftService();
let startedAt = 0;
let questionStartedAt = 0;
let countdownTimer: number | undefined;
let autoAdvanceTimer: number | undefined;
let draftSaveTimer: number | undefined;
let touchStartX = 0;
let touchStartY = 0;
let touchCurrentX = 0;
let touchCurrentY = 0;
let touchStartedAt = 0;
let horizontalTouch = false;
const question = computed(() => bundle.value?.questions[index.value]);
const questionPresentation = computed(() => question.value
  ? resolveQuestionPresentation(question.value.content)
  : 'standard_choice');
const lectureDocument = computed(() => {
  const value = bundle.value;
  if (!value) return undefined;
  const primaryLink = value.lectureLinks.find((link) => link.relationRole === 'primary') || value.lectureLinks[0];
  const lecture = value.lectures.find((item) => item.id === primaryLink?.lectureId) || value.lectures[0];
  return value.documents.find((document) => document.id === lecture?.contentDocumentId);
});
const lectureTitle = computed(() => lectureDocument.value?.title || '知识点讲义');
const practiceCategory = computed(() => {
  const module = moduleLabel(bundle.value?.questionSet.module || '');
  return capabilityName.value && capabilityName.value !== module ? `${module} · ${capabilityName.value}` : module || '做题';
});
const sessionMeta = computed(() => {
  if (activeTab.value === 'lecture') return `配套讲义 · ${lectureTitle.value}`;
  if (submitted.value) return `${index.value + 1}/${bundle.value?.questions.length || 0} · 批改结果`;
  return `${index.value + 1}/${bundle.value?.questions.length || 0} · 已答 ${answeredCount.value}`;
});
const countdownLabel = computed(() => {
  const minutes = Math.floor(remainingSeconds.value / 60);
  const seconds = remainingSeconds.value % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
});
const materialGroupQuestions = computed(() => {
  const groupId = question.value?.content.materialGroupId;
  return groupId
    ? (bundle.value?.questions || []).filter((item) => item.content.materialGroupId === groupId)
    : [];
});
const isSharedMaterialQuestion = computed(() => materialGroupQuestions.value.length > 1);
const materialGroupSize = computed(() => materialGroupQuestions.value.length);
const materialGroupPosition = computed(() => (
  Math.max(0, materialGroupQuestions.value.findIndex((item) => item.id === question.value?.id)) + 1
));
const answeredCount = computed(() => bundle.value?.questions.filter((item) => !!answers.value[item.id]).length ?? 0);
const unansweredCount = computed(() => (bundle.value?.questions.length ?? 0) - answeredCount.value);
const causeOptions = Object.entries(errorCauseLabel)
  .filter(([code]) => code !== ErrorCauseCode.Unknown)
  .map(([code, label]) => ({ code, label }));

const cardQuestions = computed<AnswerCardQuestionItem[]>(() =>
  (bundle.value?.questions || []).map((item) => ({
    id: item.id,
    correctOptionId: item.content.correctOptionId
  }))
);

onMounted(() => {
  void load();
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);
  countdownTimer = window.setInterval(() => {
    if (bundle.value && activeTab.value === 'questions' && !submitted.value && remainingSeconds.value > 0) {
      remainingSeconds.value -= 1;
      if (!submitting.value && remainingSeconds.value % 15 === 0) scheduleDraftSave();
    }
  }, 1000);
});
onBeforeUnmount(() => {
  if (countdownTimer) window.clearInterval(countdownTimer);
  if (autoAdvanceTimer) window.clearTimeout(autoAdvanceTimer);
  if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('pagehide', handlePageHide);
  void persistDraft();
});
async function load() {
  try {
    const manifestId = String(route.query.manifestId || '');
    const id = String(route.query.questionSetId || '');
    const loaded = await (await sessionFeature()).load({ questionSetId: id || undefined, manifestId: manifestId || undefined });
    const value = loaded.bundle;
    manifestSections.value = [...loaded.manifestSections];
    bundle.value = value;
    capabilityName.value = loaded.capabilityName;
    assessmentRoleOverride.value = loaded.assessmentRoleOverride;
    sourceMetadata.value = loaded.sourceMetadata;
    startedAt = Date.now();
    questionStartedAt = startedAt;
    remainingSeconds.value = Math.round(loaded.durationMinutes * 60);
    const targetSetIds = manifestSections.value.length
      ? new Set(manifestSections.value.map((item) => item.bundle.questionSet.id))
      : new Set([value.questionSet.id]);
    if (loaded.previousReviews.length) {
      answers.value = Object.fromEntries(loaded.previousReviews.flatMap((previous) => previous.items).flatMap(({ attempt }) => {
        const optionId = typeof attempt.answer.optionId === 'string' ? attempt.answer.optionId : '';
        return optionId ? [[attempt.questionId, optionId]] : [];
      }));
      const previousAttempts = loaded.previousReviews.flatMap((previous) => previous.items.map((item) => item.attempt));
      elapsedByQuestion.value = Object.fromEntries(previousAttempts.map((attempt) => [attempt.questionId, attempt.elapsedMs || 0]));
      answerChanges.value = Object.fromEntries(previousAttempts.map((attempt) => [attempt.questionId, attempt.answerChangeCount]));
      reviewSessionIds.value = loaded.previousReviews.map((previous) => previous.session.id);
      review.value = mergeReviews(loaded.previousReviews);
      submitted.value = loaded.previousReviews.length === targetSetIds.size;
      if (submitted.value) remainingSeconds.value = 0;
    }
    const runtime = await initializeTutorRuntime();
    if (submitted.value) {
      await draftService.clear(runtime, draftIdentity());
    } else {
      const draft = await draftService.load(runtime, draftIdentity(), value);
      if (draft) {
        answers.value = { ...draft.answers, ...answers.value };
        elapsedByQuestion.value = { ...draft.elapsedByQuestion, ...elapsedByQuestion.value };
        answerChanges.value = { ...draft.answerChanges, ...answerChanges.value };
        const restoredIndex = value.questions.findIndex((item) => item.id === draft.currentQuestionId);
        index.value = restoredIndex >= 0 ? restoredIndex : 0;
        startedAt = Date.now() - draft.elapsedMs;
        questionStartedAt = Date.now() - draft.currentQuestionElapsedMs;
        remainingSeconds.value = draft.remainingSeconds;
      }
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取题组失败';
  }
}
function selectOption(optionId: string) {
  if (!question.value || submitted.value || submitting.value) return;
  const questionId = question.value.id;
  const previous = answers.value[questionId];
  if (previous && previous !== optionId) answerChanges.value[questionId] = (answerChanges.value[questionId] || 0) + 1;
  if (elapsedByQuestion.value[questionId] === undefined) {
    elapsedByQuestion.value[questionId] = Math.max(0, Date.now() - questionStartedAt);
  }
  answers.value[questionId] = optionId;
  scheduleDraftSave();
  if (autoAdvanceTimer) window.clearTimeout(autoAdvanceTimer);
  if (index.value < (bundle.value?.questions.length ?? 1) - 1) {
    const expectedQuestionId = questionId;
    autoAdvanceTimer = window.setTimeout(() => {
      if (question.value?.id !== expectedQuestionId || submitted.value) return;
      changeQuestion(index.value + 1);
      autoAdvanceTimer = undefined;
    }, 220);
  }
}
function goTo(next: number) {
  changeQuestion(next);
  showAnswerCard.value = false;
}
function changeQuestion(next: number) {
  if (submitting.value) return;
  const total = bundle.value?.questions.length ?? 0;
  if (!total || next < 0 || next >= total || next === index.value) return;
  if (autoAdvanceTimer) window.clearTimeout(autoAdvanceTimer);
  autoAdvanceTimer = undefined;
  index.value = next;
  questionStartedAt = Date.now();
  questionScroll.value?.scrollTo({ top: 0, behavior: 'auto' });
  scheduleDraftSave();
}
function handleQuestionTouchStart(event: TouchEvent) {
  const touch = event.touches[0];
  if (!touch || activeTab.value !== 'questions' || submitting.value) return;
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
  touchCurrentX = touch.clientX;
  touchCurrentY = touch.clientY;
  touchStartedAt = Date.now();
  horizontalTouch = false;
}
function handleQuestionTouchMove(event: TouchEvent) {
  const touch = event.touches[0];
  if (!touch || !touchStartedAt) return;
  touchCurrentX = touch.clientX;
  touchCurrentY = touch.clientY;
  const deltaX = touchCurrentX - touchStartX;
  const deltaY = touchCurrentY - touchStartY;
  if (!horizontalTouch && Math.abs(deltaX) >= 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
    horizontalTouch = true;
  }
  if (horizontalTouch && event.cancelable) event.preventDefault();
}
function handleQuestionTouchEnd() {
  if (!touchStartedAt) return;
  const direction = resolveQuestionSwipe({
    deltaX: touchCurrentX - touchStartX,
    deltaY: touchCurrentY - touchStartY,
    durationMs: Date.now() - touchStartedAt
  });
  resetQuestionTouch();
  if (direction) changeQuestion(index.value + direction);
}
function resetQuestionTouch() {
  touchStartedAt = 0;
  horizontalTouch = false;
}
function requestSubmit() {
  if (!submitting.value && !submitted.value) showSubmitConfirm.value = true;
}
async function submit() {
  if (!bundle.value || submitting.value) return;
  showSubmitConfirm.value = false;
  submitting.value = true;
  if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
  draftSaveTimer = undefined;
  try {
    const runtime = await initializeTutorRuntime();
    const reviewQueueItemId = String(route.query.reviewQueueItemId || '') || undefined;
    const dailyPlanItemId = String(route.query.dailyPlanItemId || '') || undefined;
    const defaultThreadId = String(route.query.learningThreadId || bundle.value.questionSet.learningThreadId || '');
    const targets = manifestSections.value.length
      ? manifestSections.value
      : defaultThreadId
        ? [{ bundle: bundle.value, learningThreadId: defaultThreadId, module: bundle.value.questionSet.module }]
        : [];
    if (!targets.length) throw new Error('学习主线参数缺失。');
    const results = [];
    const submissionScope = String(route.query.manifestId || route.query.questionSetId || bundle.value.questionSet.id);
    for (const target of targets) {
      results.push(await submitBundle(
        runtime,
        target.bundle,
        target.learningThreadId,
        submissionScope,
        assessmentRoleOverride.value,
        manifestSections.value.length ? undefined : reviewQueueItemId,
        manifestSections.value.length ? undefined : dailyPlanItemId
      ));
    }
    reviewSessionIds.value = results.map((result) => result.sessionId);
    review.value = mergeReviews(await Promise.all(
      reviewSessionIds.value.map((sessionId) => runtime.getObjectiveSessionReview.execute(
        sessionId as Parameters<typeof runtime.getObjectiveSessionReview.execute>[0]
      ))
    ));
    submitted.value = true;
    index.value = 0;
    error.value = '';
    void draftService.clear(runtime, draftIdentity()).catch(() => undefined);
    objectiveSubmissionRecoveryCoordinator.start();
    if (review.value?.items.some((item) => item.grading.result === 'incorrect')) {
      void watchDiagnoses(reviewSessionIds.value);
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '提交失败';
  } finally {
    submitting.value = false;
  }
}
function draftIdentity(): PracticeSessionDraftIdentity {
  const manifestId = String(route.query.manifestId || '').trim();
  const questionSetId = String(route.query.questionSetId || bundle.value?.questionSet.id || '').trim();
  return manifestId ? { manifestId } : { questionSetId };
}
function scheduleDraftSave() {
  if (!bundle.value || submitted.value || submitting.value) return;
  if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(() => {
    draftSaveTimer = undefined;
    void persistDraft();
  }, 180);
}
async function persistDraft(existingRuntime?: Awaited<ReturnType<typeof initializeTutorRuntime>>) {
  if (!bundle.value || submitted.value) return;
  try {
    const runtime = existingRuntime ?? await initializeTutorRuntime();
    await draftService.save(runtime, draftIdentity(), {
      version: 1,
      answers: answers.value,
      elapsedByQuestion: elapsedByQuestion.value,
      answerChanges: answerChanges.value,
      currentQuestionId: question.value?.id,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      currentQuestionElapsedMs: Math.max(0, Date.now() - questionStartedAt),
      remainingSeconds: remainingSeconds.value,
      updatedAt: Date.now()
    });
  } catch {
    if (!error.value) error.value = '答题进度暂时无法自动保存，请先不要退出页面。';
  }
}
function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') void persistDraft();
}
function handlePageHide() {
  void persistDraft();
}
async function submitBundle(
  runtime: Awaited<ReturnType<typeof initializeTutorRuntime>>,
  targetBundle: CommittedQuestionSetBundle,
  learningThreadId: string,
  submissionScope: string,
  assessmentRoleOverride?: AssessmentRole,
  reviewQueueItemId?: string,
  dailyPlanItemId?: string
) {
  const completedAt = Date.now();
  return runtime.submitObjectiveSession.execute({
    idempotencyKey: `practice:submit:${submissionScope}:${targetBundle.questionSet.id}:${learningThreadId}`,
    learningThreadId: learningThreadId as Parameters<typeof runtime.submitObjectiveSession.execute>[0]['learningThreadId'],
    questionSetId: targetBundle.questionSet.id,
    questionIds: targetBundle.questions.map((item) => item.id),
    assessmentRole: assessmentRoleOverride,
    reviewQueueItemId: reviewQueueItemId as Parameters<typeof runtime.submitObjectiveSession.execute>[0]['reviewQueueItemId'],
    dailyPlanItemId,
    startedAt: startedAt as Parameters<typeof runtime.submitObjectiveSession.execute>[0]['startedAt'],
    elapsedMs: completedAt - startedAt,
    answers: targetBundle.questions.map((item) => ({
      questionId: item.id,
      optionId: answers.value[item.id],
      elapsedMs: elapsedByQuestion.value[item.id],
      answerChangeCount: answerChanges.value[item.id] || 0
    }))
  });
}
async function watchDiagnoses(sessionIds: readonly string[]) {
  diagnosing.value = true;
  try {
    const runtime = await initializeTutorRuntime();
    objectiveSubmissionRecoveryCoordinator.start();
    let terminalRuns: Awaited<ReturnType<typeof runtime.getAgentRunViews.execute>> = [];
    for (let poll = 0; poll < 180; poll += 1) {
      const nextReview = mergeReviews(await Promise.all(sessionIds.map((sessionId) => (
        runtime.getObjectiveSessionReview.execute(sessionId as Parameters<typeof runtime.getObjectiveSessionReview.execute>[0])
      ))));
      if (nextReview) review.value = nextReview;
      const incorrectItems = nextReview?.items.filter((item) => item.grading.result === 'incorrect') ?? [];
      if (
        incorrectItems.length
        && incorrectItems.every((item) => item.diagnoses.some((diagnosis) => diagnosis.source === 'tutor_ai'))
      ) {
        return;
      }

      const views = await runtime.getAgentRunViews.execute({ limit: 50 });
      const targetSessions = new Set(sessionIds);
      terminalRuns = views.filter((run) => (
        run.targetResourceType === 'error_diagnosis_batch'
        && Boolean(run.targetResourceId)
        && targetSessions.has(run.targetResourceId!)
        && !run.isActive
      ));
      const failed = terminalRuns.find((run) => run.status === 'failed');
      if (failed) throw new Error(failed.detail);
      const cancelled = terminalRuns.find((run) => run.status === 'cancelled');
      if (cancelled) throw new Error('本次错因分析已取消');
      if (views.some((run) => (
        run.targetResourceType === 'error_diagnosis_batch'
        && Boolean(run.targetResourceId)
        && targetSessions.has(run.targetResourceId!)
        && run.isActive
      ))) {
        agentWorkerCoordinator.start(runtime);
      }
      await wait(800);
    }
    throw new Error('分析仍在后台执行，可稍后在本题查看结果');
  } catch (cause) {
    error.value = cause instanceof Error ? `错因分析稍后重试：${cause.message}` : '错因分析稍后重试';
  } finally {
    diagnosing.value = false;
  }
}
function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}
function effectiveDiagnosisFor(questionId: string): { record: ErrorDiagnosisRecord; projection?: ErrorDiagnosisCurrentProjection; causeCode: keyof typeof errorCauseLabel; detail: string; confirmationStatus: string } | undefined {
  const item = review.value?.items.find((value) => value.question.id === questionId);
  const record = [...(item?.diagnoses ?? [])].sort((left, right) => diagnosisPriority(right) - diagnosisPriority(left) || right.createdAt - left.createdAt)[0];
  if (!record) return undefined;
  const projection = item?.diagnosisProjections.find((value) => value.diagnosisId === record.id);
  return {
    record,
    projection,
    causeCode: projection?.effectiveCauseCode ?? record.causeCode,
    detail: projection?.effectiveDetail ?? record.detail,
    confirmationStatus: projection?.confirmationStatus ?? record.confirmationStatus
  };
}
function diagnosisLabel(questionId: string): string { const diagnosis = effectiveDiagnosisFor(questionId); return diagnosis ? errorCauseLabel[diagnosis.causeCode] : ''; }
function diagnosisDetail(questionId: string): string {
  const diagnosis = effectiveDiagnosisFor(questionId);
  if (!diagnosis || diagnosis.causeCode === ErrorCauseCode.Unknown) {
    return diagnosing.value
      ? 'AI 正在结合题目、选项和本次作答进一步分析。'
      : '目前只能确认本题答错，暂时还无法判断具体原因。可以先查看解析，或让 AI 帮你讲透。';
  }
  return diagnosis.detail;
}
function hasSpecificDiagnosisFor(questionId: string): boolean {
  const diagnosis = effectiveDiagnosisFor(questionId);
  return Boolean(diagnosis && diagnosis.causeCode !== ErrorCauseCode.Unknown);
}
function diagnosisPriority(diagnosis: ErrorDiagnosisRecord): number { return diagnosis.source === 'tutor_ai' ? 2 : diagnosis.causeCode === 'unknown' ? 0 : 1; }
function isIncorrect(questionId: string): boolean { return review.value?.items.find((item) => item.question.id === questionId)?.grading.result === 'incorrect'; }
async function askAIAboutCurrentQuestion() {
  const current = question.value;
  if (!current || askingAi.value || chat.isSending) return;
  askingAi.value = true;
  try {
    const diagnosis = effectiveDiagnosisFor(current.id);
    const selectedOptionId = answers.value[current.id] || '未作答';
    const material = current.content.material ? contentDocumentText(current.content.material) : '';
    const prompt = contentDocumentText(current.content.prompt);
    const options = current.content.options.map((option) => (
      `${option.id}. ${contentDocumentText(option.content)}`
    )).join('\n');
    const title = capabilityName.value || practiceCategory.value || '错题讲解';
    const context = [
      '我想针对当前题目进行一次深度学习。请把它当作我的个人错题辅导，不要只复述答案。',
      '',
      '## 当前学习上下文',
      `- 模块：${moduleLabel(bundle.value?.questionSet.module || '')}`,
      `- 知识点：${capabilityName.value || '请根据题目识别'}`,
      `- 我的答案：${selectedOptionId}`,
      `- 正确答案：${current.content.correctOptionId}`,
      diagnosis ? `- 已有错因：${errorCauseLabel[diagnosis.causeCode]}，${diagnosis.detail}` : '- 已有错因：尚未形成',
      material ? `\n### 共用材料\n${material}` : '',
      `\n### 题干\n${prompt}`,
      `\n### 选项\n${options}`,
      '',
      '## 辅导要求',
      '1. 先指出本题考查的细分知识点和必要的前置知识。',
      '2. 按步骤还原正确推理链，并逐项比较干扰项。',
      '3. 结合我的答案和错因，指出我的思考在哪一步偏离。',
      '4. 总结一个可迁移的方法和易错提醒。',
      '5. 最后用一个简短追问检查我是否真正理解；不要输出内部思考过程。'
    ].filter(Boolean).join('\n');
    await chat.init();
    await chat.newSession(`${title} · 深度学习`);
    await chat.open(context);
  } catch (cause) {
    error.value = cause instanceof Error ? `打开 AI 深度讲解失败：${cause.message}` : '打开 AI 深度讲解失败';
  } finally {
    askingAi.value = false;
  }
}
async function confirmDiagnosis(questionId: string) {
  const diagnosis = effectiveDiagnosisFor(questionId);
  if (!diagnosis || isConfirming.value) return;
  isConfirming.value = true;
  try {
    const runtime = await initializeTutorRuntime();
    await runtime.confirmErrorDiagnosis.execute({
      idempotencyKey: `diagnosis:${diagnosis.record.id}:confirm`,
      diagnosisId: diagnosis.record.id,
      action: ErrorDiagnosisConfirmationAction.Confirm,
      actorType: 'user'
    });
    await refreshReview(runtime);
  } finally {
    isConfirming.value = false;
  }
}
function openCorrection(questionId: string) {
  const diagnosis = effectiveDiagnosisFor(questionId);
  if (!diagnosis) return;
  correctionTarget.value = diagnosis.record;
  correctedCauseCode.value = diagnosis.causeCode === ErrorCauseCode.Unknown ? '' : diagnosis.causeCode;
  correctedDetail.value = '';
  showCorrectionDialog.value = true;
}
async function submitCorrection() {
  if (!correctionTarget.value || !correctedCauseCode.value || !correctedDetail.value.trim() || isConfirming.value) return;
  isConfirming.value = true;
  try {
    const runtime = await initializeTutorRuntime();
    await runtime.confirmErrorDiagnosis.execute({
      idempotencyKey: `diagnosis:${correctionTarget.value.id}:correct:${correctedCauseCode.value}:${correctedDetail.value.trim()}`,
      diagnosisId: correctionTarget.value.id,
      action: ErrorDiagnosisConfirmationAction.Correct,
      actorType: 'user',
      correctedCauseCode: correctedCauseCode.value as Parameters<typeof runtime.confirmErrorDiagnosis.execute>[0]['correctedCauseCode'],
      correctedDetail: correctedDetail.value
    });
    showCorrectionDialog.value = false;
    await refreshReview(runtime);
  } finally {
    isConfirming.value = false;
  }
}
async function refreshReview(runtime?: Awaited<ReturnType<typeof initializeTutorRuntime>>) {
  const resolvedRuntime = runtime ?? await initializeTutorRuntime();
  const sessionIds = reviewSessionIds.value.length
    ? reviewSessionIds.value
    : review.value?.session.id ? [review.value.session.id] : [];
  if (!sessionIds.length) return;
  review.value = mergeReviews(await Promise.all(sessionIds.map((sessionId) => (
    resolvedRuntime.getObjectiveSessionReview.execute(sessionId as Parameters<typeof resolvedRuntime.getObjectiveSessionReview.execute>[0])
  ))));
  const capabilities = new Map(
    (review.value?.items || []).map((item) => [item.attempt.capabilityNodeId, item.attempt.examCycleId])
  );
  await Promise.all(Array.from(capabilities.entries()).map(([capabilityNodeId, examCycleId]) => (
    resolvedRuntime.refreshMasteryTrack.execute({ examCycleId, capabilityNodeId })
  )));
}
function mergeReviews(values: readonly (ObjectiveSessionReview | undefined)[]): ObjectiveSessionReview | undefined {
  const available = values.filter((value): value is ObjectiveSessionReview => Boolean(value));
  const first = available[0];
  return first ? { session: first.session, items: available.flatMap((value) => value.items) } : undefined;
}
const moduleLabel = practiceModuleLabel;
function sessionFeature(): Promise<PracticeSessionFeature> {
  sessionFeaturePromise ??= initializeTutorRuntime().then((runtime) => new PracticeSessionFeature(runtime));
  return sessionFeaturePromise;
}
</script>

<style scoped>
.session-tabs { display:flex; align-self:center; gap:3px; margin:6px auto 0; padding:3px; border-radius:999px; background:rgba(var(--color-ink-rgb),.055); }.session-tabs button { min-width:74px; height:30px; border:0; border-radius:999px; color:var(--text-secondary-color); background:transparent; font:inherit; font-size:var(--type-size-caption); }.session-tabs button.active { color:var(--text-color); background:rgba(255,255,255,.78); box-shadow:0 1px 5px rgba(var(--color-ink-rgb),.08); }.session-scroll { display:flex; flex-direction:column; gap:16px; padding-top:12px; padding-bottom:76px; touch-action:pan-y; }.lecture-scroll { padding-bottom:24px; }.material-group-meta { margin:0; color:var(--primary-color); font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }.session-header-meta { min-width:0; display:flex; align-items:center; gap:6px; color:var(--text-secondary-color); font-size:var(--type-size-micro); }.session-header-meta>span:first-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.session-timer { flex:0 0 auto; height:19px; display:inline-flex; align-items:center; gap:3px; padding:0 6px; border-radius:999px; color:var(--text-secondary-color); background:rgba(var(--color-ink-rgb),.045); font-size:var(--type-size-micro); font-variant-numeric:tabular-nums; }.session-timer.warning { color:var(--red-color); background:rgba(255,59,48,.09); }.session-timer svg { width:12px; height:12px; }.answer-card-button { width:36px; height:36px; display:grid; place-items:center; border:0; border-radius:50%; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.1); }.answer-card-button svg { width:17px; height:17px; }.options { display:flex; flex-direction:column; gap:7px; }.options button { display:flex; align-items:flex-start; gap:9px; padding:10px; border:0; border-radius:8px; background:rgba(var(--color-ink-rgb),.035); color:inherit; text-align:left; }.options button.selected { background:rgba(var(--color-brand-rgb),.11); }.options button.correct { background:rgba(52,199,89,.14); }.options button.wrong { background:rgba(255,59,48,.12); }.options b { width:22px; height:22px; display:grid; place-items:center; border-radius:50%; background:rgba(var(--color-ink-rgb),.08); font-size:var(--type-size-caption); flex:0 0 auto; }.diagnosis { padding:12px; border-radius:8px; background:rgba(255,149,0,.075); }.diagnosis-heading { min-height:30px; display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }.diagnosis-heading strong { margin:0; }.ask-ai-button { min-height:30px; display:flex; align-items:center; gap:5px; padding:0 9px; border:0; border-radius:999px; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.1); font:inherit; font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }.ask-ai-button svg { width:14px; height:14px; }.ask-ai-button:disabled { opacity:.5; }.diagnosis.pending { animation:diagnosis-pulse 1.2s ease-in-out infinite; }.diagnosis b { display:block; font-size:var(--type-size-secondary); }.diagnosis p { margin:4px 0 0; color:var(--text-secondary-color); font-size:var(--type-size-secondary); line-height:1.5; }.diagnosis small { display:block; margin-top:8px; color:var(--green-color); font-size:var(--type-size-micro); }.diagnosis-actions { display:flex; gap:8px; margin-top:10px; }.diagnosis-actions button { min-height:32px; padding:0 10px; border:0; border-radius:8px; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.1); font:inherit; font-size:var(--type-size-caption); }.diagnosis-actions button:disabled { opacity:.5; }@keyframes diagnosis-pulse { 50% { opacity:.62; } }.session-error { margin:0; color:var(--red-color); font-size:var(--type-size-caption); }.session-actions { position:fixed; left:0; right:0; bottom:0; display:flex; gap:8px; padding:8px max(12px,env(safe-area-inset-left)) calc(8px + env(safe-area-inset-bottom)); background:rgba(250,251,253,.9); backdrop-filter:blur(14px); }.session-actions button { flex:1; height:40px; border:0; border-radius:10px; background:rgba(var(--color-ink-rgb),.08); color:var(--text-color); font:inherit; }.session-actions button:last-child { background:var(--primary-color); color:#fff; }.session-actions button:disabled { opacity:.45; }.session-empty { display:grid; place-items:center; min-height:50vh; color:var(--text-secondary-color); padding:20px; text-align:center; }.answer-card-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; }.answer-card-grid button { height:36px; border:0; border-radius:9px; color:var(--text-secondary-color); background:rgba(var(--color-ink-rgb),.06); font:inherit; }.answer-card-grid button.answered { color:var(--primary-color); background:rgba(var(--color-brand-rgb),.12); }.answer-card-grid button.active { outline:2px solid var(--primary-color); outline-offset:1px; }.answer-card-grid button.wrong { color:var(--red-color); background:rgba(255,59,48,.12); }.correction-form { display:flex; flex-direction:column; gap:12px; }.correction-form>span,.correction-form label>span { color:var(--text-secondary-color); font-size:var(--type-size-caption); }.cause-options { display:flex; flex-wrap:wrap; gap:7px; }.cause-options button { min-height:32px; padding:0 10px; border:0; border-radius:999px; color:var(--text-secondary-color); background:var(--surface-control); font:inherit; font-size:var(--type-size-caption); }.cause-options button.active { color:var(--primary-color); background:rgba(var(--color-brand-rgb),.12); }.correction-form label { display:flex; flex-direction:column; gap:6px; }.correction-form textarea { width:100%; resize:none; border:0; border-radius:8px; padding:10px; color:var(--text-color); background:var(--surface-control); font:inherit; line-height:1.5; }.correction-submit { min-height:40px; border:0; border-radius:10px; color:#fff; background:var(--primary-color); font:inherit; }.correction-submit:disabled { opacity:.45; }
.question-source-meta { margin:0; display:flex; align-items:center; gap:7px; color:var(--text-secondary-color); font-size:var(--type-size-caption); line-height:1.4; }
.question-source-meta span { flex:0 0 auto; padding:3px 7px; border-radius:999px; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.1); font-size:var(--type-size-micro); font-weight:var(--type-weight-semibold); }
.question-material-region,.question-answer-region { display:flex; flex-direction:column; gap:14px; min-width:0; }.question-presentation-data_material_choice .question-material-region,.question-presentation-shared_material_choice .question-material-region,.question-presentation-long_reading_choice .question-material-region { padding-bottom:4px; border-bottom:1px solid rgba(var(--color-ink-rgb),.06); }
</style>
