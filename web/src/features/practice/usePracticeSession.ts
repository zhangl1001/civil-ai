import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { agentWorkerCoordinator, initializeTutorRuntime } from '@/composition-root/public';
import { objectiveSubmissionRecoveryCoordinator } from '@/composition-root/evidence/ObjectiveSubmissionRecoveryCoordinator';
import type { AssessmentRole } from '@/kernel/public';
import { findQuestionSetEnrichmentNeeds, hasQuestionSetEnrichmentNeeds, type CommittedQuestionSetBundle, type QuestionSetSourceSummary } from '@/modules/content/public';
import { submittedOptionIds, type ObjectiveSessionReview } from '@/modules/evidence/public';
import { applyCompletedQuestionSets, PracticeSessionFeature, type PracticeManifestSection } from './PracticeSessionFeature';
import { PracticeSessionDraftService, type PracticeSessionDraftIdentity } from './PracticeSessionDraftService';
import { practiceSubmissionKey, submitPracticeBundle } from './SubmitPracticeBundle';

type TutorRuntime = Awaited<ReturnType<typeof initializeTutorRuntime>>;

interface SessionIdentity extends PracticeSessionDraftIdentity {
  readonly learningThreadId?: string;
  readonly dailyPlanItemId?: string;
  readonly reviewQueueItemId?: string;
}

function submissionScopeOf(identity: SessionIdentity, bundle: CommittedQuestionSetBundle): string {
  return identity.manifestId || identity.questionSetId || bundle.questionSet.id;
}

function submissionTargetsOf(
  identity: SessionIdentity,
  bundle: CommittedQuestionSetBundle,
  sections: readonly PracticeManifestSection[]
): PracticeManifestSection[] {
  if (sections.length) return [...sections];
  const learningThreadId = identity.learningThreadId || bundle.questionSet.learningThreadId;
  return learningThreadId ? [{ bundle, learningThreadId, module: bundle.questionSet.module }] : [];
}

/**
 * Whether every section of this page already committed. A manifest that does
 * not restore earlier reviews (wrong-book redo, true-question practice) has
 * no other way to tell that its leftover draft belongs to a finished paper.
 * An unreadable answer keeps the draft: restoring answers is the safe side.
 */
async function hasCommittedSubmission(
  runtime: TutorRuntime,
  identity: SessionIdentity,
  bundle: CommittedQuestionSetBundle,
  sections: readonly PracticeManifestSection[]
): Promise<boolean> {
  const targets = submissionTargetsOf(identity, bundle, sections);
  if (!targets.length) return false;
  const scope = submissionScopeOf(identity, bundle);
  try {
    const committed = await Promise.all(targets.map((target) => runtime.learningSessionRepository.findByIdempotencyKey(
      practiceSubmissionKey(scope, target.bundle.questionSet.id, target.learningThreadId)
    )));
    return committed.every(Boolean);
  } catch {
    return false;
  }
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
      let draft = persisted ? undefined : await draftService.load(runtime, nextIdentity, loaded.bundle);
      signal.throwIfAborted();
      // A draft whose retirement failed after its paper committed is stale:
      // retire it again instead of reopening that paper as unanswered work.
      if (draft && await hasCommittedSubmission(runtime, nextIdentity, loaded.bundle, loaded.manifestSections)) {
        draft = undefined;
        await draftService.clear(runtime, nextIdentity).catch(() => undefined);
      }
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
      // A persisted page never restores its draft, so retiring it is best effort.
      if (persisted) await draftService.clear(runtime, nextIdentity).catch(() => undefined);
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
    const isManifest = manifestSections.value.length > 0;
    const targets = submissionTargetsOf(savedIdentity, bundle.value, manifestSections.value);
    const snapshot = {
      submissionScope: submissionScopeOf(savedIdentity, bundle.value),
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
        // Awaited so a reload of this identity never reads the draft first; a
        // failed retirement must not report the committed paper as unsubmitted,
        // and the next load retires the leftover draft (hasCommittedSubmission).
        await draftService.clear(runtime, savedIdentity).catch(() => undefined);
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
