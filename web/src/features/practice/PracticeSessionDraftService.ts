import type { TutorDatabaseRuntime } from '@/composition-root/public';
import {
  LearningAssetKind,
  QuestionSetPracticeStatus,
  type CommittedQuestionSetBundle
} from '@/modules/content/public';

/** v2 stores each answer as a list of option ids so multi-answer templates fit. */
const DRAFT_VERSION = 2;

export interface PracticeSessionDraftIdentity {
  readonly questionSetId?: string;
  readonly manifestId?: string;
}

export interface PracticeSessionDraft {
  readonly version: typeof DRAFT_VERSION;
  readonly answers: Readonly<Record<string, readonly string[]>>;
  readonly elapsedByQuestion: Readonly<Record<string, number>>;
  readonly answerChanges: Readonly<Record<string, number>>;
  readonly currentQuestionId?: string;
  readonly elapsedMs: number;
  readonly currentQuestionElapsedMs: number;
  readonly remainingSeconds: number;
  readonly updatedAt: number;
}

/** Callers describe the progress; the service owns the stored version. */
export type PracticeSessionDraftInput = Omit<PracticeSessionDraft, 'version'>;

export class PracticeSessionDraftService {
  private saveQueue: Promise<void> = Promise.resolve();
  private readonly startedQuestionSets = new Set<string>();

  async load(
    runtime: TutorDatabaseRuntime,
    identity: PracticeSessionDraftIdentity,
    bundle: CommittedQuestionSetBundle
  ): Promise<PracticeSessionDraft | undefined> {
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return undefined;
    const asset = await runtime.learningAssetStore.findLatest(
      cycle.examCycle.id,
      LearningAssetKind.PracticeSessionDraft,
      businessKey(identity)
    );
    if (!asset || asset.status !== 'draft') return undefined;
    return parseDraft(asset.payload, bundle);
  }

  async save(
    runtime: TutorDatabaseRuntime,
    identity: PracticeSessionDraftIdentity,
    draft: PracticeSessionDraftInput
  ): Promise<void> {
    const snapshot = {
      ...draft,
      answers: Object.fromEntries(Object.entries(draft.answers).map(([key, item]) => [key, [...item]])),
      elapsedByQuestion: { ...draft.elapsedByQuestion },
      answerChanges: { ...draft.answerChanges }
    };
    this.saveQueue = this.saveQueue.catch(() => undefined).then(async () => {
      const cycle = await runtime.candidateRepository.findCurrentCycle();
      if (!cycle) return;
      await runtime.learningAssetStore.saveDraft({
        examCycleId: cycle.examCycle.id,
        kind: LearningAssetKind.PracticeSessionDraft,
        businessKey: businessKey(identity),
        title: '答题进度',
        payload: {
          version: DRAFT_VERSION,
          answers: snapshot.answers,
          elapsedByQuestion: snapshot.elapsedByQuestion,
          answerChanges: snapshot.answerChanges,
          currentQuestionId: snapshot.currentQuestionId ?? null,
          elapsedMs: nonNegativeInteger(snapshot.elapsedMs),
          currentQuestionElapsedMs: nonNegativeInteger(snapshot.currentQuestionElapsedMs),
          remainingSeconds: nonNegativeInteger(snapshot.remainingSeconds),
          updatedAt: nonNegativeInteger(snapshot.updatedAt)
        }
      });
      const questionSetId = identity.questionSetId?.trim();
      if (questionSetId && !this.startedQuestionSets.has(questionSetId)) {
        await runtime.unitOfWork.runAutocommit((context) => runtime.contentRepository.updateQuestionSetPracticeStatus(
          questionSetId as Parameters<typeof runtime.contentRepository.updateQuestionSetPracticeStatus>[0],
          QuestionSetPracticeStatus.InProgress,
          context
        ));
        this.startedQuestionSets.add(questionSetId);
      }
    });
    await this.saveQueue;
  }

  async clear(runtime: TutorDatabaseRuntime, identity: PracticeSessionDraftIdentity): Promise<void> {
    await this.saveQueue.catch(() => undefined);
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return;
    await runtime.learningAssetStore.retireBusinessKey(
      cycle.examCycle.id,
      LearningAssetKind.PracticeSessionDraft,
      businessKey(identity)
    );
  }
}

function businessKey(identity: PracticeSessionDraftIdentity): string {
  const manifestId = identity.manifestId?.trim();
  if (manifestId) return `manifest:${manifestId}`;
  const questionSetId = identity.questionSetId?.trim();
  if (questionSetId) return `question-set:${questionSetId}`;
  throw new Error('Practice session draft identity is required');
}

function parseDraft(payload: Record<string, unknown>, bundle: CommittedQuestionSetBundle): PracticeSessionDraft | undefined {
  if (payload.version !== DRAFT_VERSION) return undefined;
  const validOptions = new Map<string, Set<string>>(bundle.questions.map((question) => [
    String(question.id),
    new Set(question.content.options.map((option) => option.id))
  ]));
  const answers = optionIdsMap(payload.answers, validOptions);
  const elapsedByQuestion = numberMap(payload.elapsedByQuestion, (questionId) => validOptions.has(questionId));
  const answerChanges = numberMap(payload.answerChanges, (questionId) => validOptions.has(questionId));
  const currentQuestionId = typeof payload.currentQuestionId === 'string' && validOptions.has(payload.currentQuestionId)
    ? payload.currentQuestionId
    : undefined;
  return {
    version: DRAFT_VERSION,
    answers,
    elapsedByQuestion,
    answerChanges,
    currentQuestionId,
    elapsedMs: nonNegativeInteger(payload.elapsedMs),
    currentQuestionElapsedMs: nonNegativeInteger(payload.currentQuestionElapsedMs),
    remainingSeconds: nonNegativeInteger(payload.remainingSeconds),
    updatedAt: nonNegativeInteger(payload.updatedAt)
  };
}

/**
 * Restores selections, dropping any option the current question no longer has.
 * A regenerated question set must not resurrect answers to options that moved.
 */
function optionIdsMap(
  value: unknown,
  validOptions: ReadonlyMap<string, ReadonlySet<string>>
): Record<string, readonly string[]> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([questionId, item]) => {
    const options = validOptions.get(questionId);
    if (!options || !Array.isArray(item)) return [];
    const optionIds = item.filter((entry): entry is string => typeof entry === 'string' && options.has(entry));
    return optionIds.length ? [[questionId, [...new Set(optionIds)]]] : [];
  }));
}

function numberMap(value: unknown, accept: (key: string) => boolean): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => (
    accept(key) && Number.isFinite(item)
      ? [[key, nonNegativeInteger(item)]]
      : []
  )));
}

function nonNegativeInteger(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
