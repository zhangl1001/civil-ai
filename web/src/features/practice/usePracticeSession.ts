import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { agentWorkerCoordinator, initializeTutorRuntime } from '@/composition-root/public';
import { objectiveSubmissionRecoveryCoordinator } from '@/composition-root/evidence/ObjectiveSubmissionRecoveryCoordinator';
import type { AssessmentRole } from '@/kernel/public';
import { findQuestionSetEnrichmentNeeds, hasQuestionSetEnrichmentNeeds, type CommittedQuestionSetBundle, type QuestionSetSourceSummary } from '@/modules/content/public';
import { submittedOptionIds, type ObjectiveSessionReview } from '@/modules/evidence/public';
import { applyCompletedQuestionSets, PracticeSessionFeature, type PracticeManifestSection } from './PracticeSessionFeature';
import { PracticeSessionDraftService, type PracticeSessionDraftIdentity } from './PracticeSessionDraftService';
import { submitPracticeBundle } from './SubmitPracticeBundle';

interface SessionIdentity extends PracticeSessionDraftIdentity {
  readonly learningThreadId?: string;
  readonly dailyPlanItemId?: string;
  readonly reviewQueueItemId?: string;
}

export function mergePracticeReviews(values: readonly (ObjectiveSessionReview | undefined)[]): ObjectiveSessionReview | undefined {
  const available = values.filter((value): value is ObjectiveSessionReview => Boolean(value));
  const first = available[0];
  return first ? { session: first.session, items: available.flatMap((value) => value.items) } : undefined;
}

/** Owns a route generation: display, draft and submission share its frozen identity. */
export function usePracticeSession() {
  const route = useRoute();
  const bundle = ref<CommittedQuestionSetBundle>();
  const manifestSections = ref<PracticeManifestSection[]>([]);
  const answers = ref<Record<string, readonly string[]>>({});
  const elapsedByQuestion = ref<Record<string, number>>({});
  const answerChanges = ref<Record<string, number>>({});
  const error = ref('');
  const index = ref(0);
  const remainingSeconds = ref(0);
  const capabilityName = ref('');
  const assessmentRoleOverride = ref<AssessmentRole>();
  const sourceMetadata = ref<QuestionSetSourceSummary>();
  const review = ref<ObjectiveSessionReview>();
  const reviewSessionIds = ref<string[]>([]);
  const submitted = ref(false);
  const submitting = ref(false);
  const submissionPersisted = ref(false);
  const contentCompleting = ref(false);
  const questionStartedAt = ref(0);
  let startedAt = 0;
  let identity: SessionIdentity | undefined;
  let controller = new AbortController();
  const sessionSignal = shallowRef(controller.signal);
  const draftService = new PracticeSessionDraftService();
  let draftQueue: Promise<void> = Promise.resolve();
  let pendingSubmission: Promise<void> | undefined;
  let featurePromise: Promise<PracticeSessionFeature> | undefined;
  const feature = () => featurePromise ??= initializeTutorRuntime().then((runtime) => new PracticeSessionFeature(runtime));

  function routeIdentity(): SessionIdentity {
    const text = (key: string) => typeof route.query[key] === 'string' ? route.query[key].trim() || undefined : undefined;
    return Object.freeze({ questionSetId: text('questionSetId'), manifestId: text('manifestId'),
      learningThreadId: text('learningThreadId'), dailyPlanItemId: text('dailyPlanItemId'), reviewQueueItemId: text('reviewQueueItemId') });
  }

  watch(() => JSON.stringify(routeIdentity()), () => {
    void persistDraft();
    controller.abort();
    controller = new AbortController();
    sessionSignal.value = controller.signal;
    identity = undefined;
    bundle.value = undefined;
    manifestSections.value = [];
    answers.value = {};
    elapsedByQuestion.value = {};
    answerChanges.value = {};
    review.value = undefined;
    reviewSessionIds.value = [];
    submitted.value = submitting.value = submissionPersisted.value = contentCompleting.value = false;
    index.value = remainingSeconds.value = 0;
    capabilityName.value = error.value = '';
    sourceMetadata.value = undefined;
    assessmentRoleOverride.value = undefined;
    void load(routeIdentity(), controller.signal);
  }, { immediate: true, flush: 'sync' });

  onBeforeUnmount(() => {
    void persistDraft();
    controller.abort();
  });

  async function load(nextIdentity: SessionIdentity, signal: AbortSignal) {
    try {
      // A committed submission must finish clearing its draft before this route
      // can restore it again (including A -> B -> A during a pending commit).
      await pendingSubmission;
      signal.throwIfAborted();
      const sessionFeature = await feature();
      const loaded = await sessionFeature.load(nextIdentity, signal);
      const runtime = await initializeTutorRuntime();
      signal.throwIfAborted();
      await draftQueue;
      signal.throwIfAborted();
      const targetSetIds = new Set(loaded.manifestSections.length
        ? loaded.manifestSections.map((section) => section.bundle.questionSet.id)
        : [loaded.bundle.questionSet.id]);
      const persisted = loaded.previousReviews.length === targetSetIds.size;
      const draft = persisted ? undefined : await draftService.load(runtime, nextIdentity, loaded.bundle);
      signal.throwIfAborted();
      identity = nextIdentity;
      bundle.value = loaded.bundle;
      manifestSections.value = [...loaded.manifestSections];
      capabilityName.value = loaded.capabilityName;
      assessmentRoleOverride.value = loaded.assessmentRoleOverride;
      sourceMetadata.value = loaded.sourceMetadata;
      const attempts = loaded.previousReviews.flatMap((previous) => previous.items.map((item) => item.attempt));
      answers.value = { ...draft?.answers, ...Object.fromEntries(attempts.flatMap((attempt) => {
        const optionIds = submittedOptionIds(attempt.answer);
        return optionIds.length ? [[attempt.questionId, optionIds]] : [];
      })) };
      elapsedByQuestion.value = { ...draft?.elapsedByQuestion, ...Object.fromEntries(attempts.map((attempt) => [attempt.questionId, attempt.elapsedMs || 0])) };
      answerChanges.value = { ...draft?.answerChanges, ...Object.fromEntries(attempts.map((attempt) => [attempt.questionId, attempt.answerChangeCount])) };
      reviewSessionIds.value = loaded.previousReviews.map((previous) => previous.session.id);
      review.value = mergePracticeReviews(loaded.previousReviews);
      submitted.value = submissionPersisted.value = persisted;
      startedAt = Date.now() - (draft?.elapsedMs ?? 0);
      questionStartedAt.value = Date.now() - (draft?.currentQuestionElapsedMs ?? 0);
      index.value = Math.max(0, loaded.bundle.questions.findIndex((item) => item.id === draft?.currentQuestionId));
      remainingSeconds.value = persisted ? 0 : draft?.remainingSeconds ?? Math.round(loaded.durationMinutes * 60);
      if (persisted) await draftService.clear(runtime, nextIdentity);
      signal.throwIfAborted();
      agentWorkerCoordinator.start(runtime);
      const sets = loaded.manifestSections.length ? loaded.manifestSections.map((section) => section.bundle) : [loaded.bundle];
      if (sets.some((set) => hasQuestionSetEnrichmentNeeds(findQuestionSetEnrichmentNeeds(set)))) {
        void completeContent([...targetSetIds], signal, persisted);
      }
    } catch (cause) {
      if (!signal.aborted) error.value = cause instanceof Error ? cause.message : '读取题组失败';
    }
  }

  async function completeContent(ids: readonly string[], signal: AbortSignal, exposeProgress: boolean) {
    if (signal.aborted) return;
    if (exposeProgress) contentCompleting.value = true;
    try {
      const sessionFeature = await feature();
      signal.throwIfAborted();
      await sessionFeature.waitForCompleteContent(ids, { signal, onUpdate: (completed) => {
        if (signal.aborted) return;
        const next = applyCompletedQuestionSets({ bundle: bundle.value, sections: manifestSections.value }, completed);
        bundle.value = next.bundle;
        manifestSections.value = next.sections;
      } });
    } catch (cause) {
      if (!signal.aborted && exposeProgress) error.value = cause instanceof Error ? cause.message : '逐题解析暂未补全';
    } finally {
      if (!signal.aborted && exposeProgress) contentCompleting.value = false;
    }
  }

  function persistDraft(): Promise<void> {
    if (!bundle.value || !identity || submitted.value || submitting.value || submissionPersisted.value) return Promise.resolve();
    const savedIdentity = identity;
    const signal = controller.signal;
    const snapshot = {
      answers: Object.fromEntries(Object.entries(answers.value).map(([id, options]) => [id, [...options]])),
      elapsedByQuestion: { ...elapsedByQuestion.value }, answerChanges: { ...answerChanges.value },
      currentQuestionId: bundle.value.questions[index.value]?.id,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      currentQuestionElapsedMs: Math.max(0, Date.now() - questionStartedAt.value),
      remainingSeconds: remainingSeconds.value, updatedAt: Date.now()
    };
    // Enqueue before the runtime await so both route restoration and clear see
    // pending saves. The snapshot never reads the next route's mutable state.
    draftQueue = draftQueue.then(async () => {
      await draftService.save(await initializeTutorRuntime(), savedIdentity, snapshot);
    }).catch(() => {
      if (!signal.aborted && !error.value) error.value = '答题进度暂时无法自动保存，请先不要退出页面。';
    });
    return draftQueue;
  }

  function submit(): Promise<void> {
    if (!bundle.value || !identity || submitting.value || submitted.value) return Promise.resolve();
    const signal = controller.signal;
    const savedIdentity = identity;
    const defaultThreadId = savedIdentity.learningThreadId || bundle.value.questionSet.learningThreadId;
    const isManifest = manifestSections.value.length > 0;
    const targets = isManifest ? [...manifestSections.value] : defaultThreadId
      ? [{ bundle: bundle.value, learningThreadId: defaultThreadId, module: bundle.value.questionSet.module }] : [];
    const snapshot = {
      submissionScope: savedIdentity.manifestId || savedIdentity.questionSetId || bundle.value.questionSet.id,
      startedAt, answers: Object.fromEntries(Object.entries(answers.value).map(([id, options]) => [id, [...options]])),
      elapsedByQuestion: { ...elapsedByQuestion.value }, answerChanges: { ...answerChanges.value },
      assessmentRoleOverride: assessmentRoleOverride.value,
      reviewQueueItemId: isManifest ? undefined : savedIdentity.reviewQueueItemId,
      dailyPlanItemId: isManifest ? undefined : savedIdentity.dailyPlanItemId
    };
    const alreadyPersisted = submissionPersisted.value;
    const savedSessionIds = [...reviewSessionIds.value];
    const saving = persistDraft();
    submitting.value = true;
    const operation = (async () => {
      try {
        const runtime = await initializeTutorRuntime();
        await saving;
        if (!targets.length) throw new Error('学习主线参数缺失。');
        const sessionIds = alreadyPersisted ? savedSessionIds : [];
        if (!alreadyPersisted) {
          for (const target of targets) {
            const result = await submitPracticeBundle({ runtime, ...snapshot, bundle: target.bundle, learningThreadId: target.learningThreadId });
            sessionIds.push(result.sessionId);
          }
        }
        // Submission already accepted by the user finishes with its captured
        // identity even if the page changes; only its UI updates are cancelled.
        await draftService.clear(runtime, savedIdentity);
        agentWorkerCoordinator.start(runtime);
        objectiveSubmissionRecoveryCoordinator.start();
        if (signal.aborted) return;
        reviewSessionIds.value = sessionIds;
        submissionPersisted.value = true;
        const reviews = await Promise.all(sessionIds.map((id) => runtime.getObjectiveSessionReview.execute(
          id as Parameters<typeof runtime.getObjectiveSessionReview.execute>[0]
        )));
        if (signal.aborted) return;
        review.value = mergePracticeReviews(reviews);
        submitted.value = true;
        index.value = 0;
        error.value = '';
        void completeContent(targets.map((target) => target.bundle.questionSet.id), signal, true);
      } catch (cause) {
        if (!signal.aborted) error.value = cause instanceof Error ? cause.message : '提交失败';
      } finally {
        if (!signal.aborted) submitting.value = false;
      }
    })();
    pendingSubmission = operation;
    void operation.finally(() => { if (pendingSubmission === operation) pendingSubmission = undefined; });
    return operation;
  }

  return { bundle, manifestSections, answers, elapsedByQuestion, answerChanges, error, index, remainingSeconds,
    capabilityName, assessmentRoleOverride, sourceMetadata, review, reviewSessionIds, submitted, submitting,
    submissionPersisted, contentCompleting, questionStartedAt, sessionSignal, persistDraft, submit };
}
