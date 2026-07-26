import type { TutorDatabaseRuntime } from '@/composition-root/public';
import {
  LearningAssetKind,
  QuestionSetPracticeStatus,
  type CommittedQuestionSetBundle
} from '@/modules/content/public';

const DRAFT_VERSION = 1;

export interface PracticeSessionDraftIdentity {
  readonly questionSetId?: string;
  readonly manifestId?: string;
}

export interface PracticeSessionDraft {
  readonly version: typeof DRAFT_VERSION;
  readonly answers: Readonly<Record<string, string>>;
  readonly elapsedByQuestion: Readonly<Record<string, number>>;
  readonly answerChanges: Readonly<Record<string, number>>;
  readonly currentQuestionId?: string;
  readonly elapsedMs: number;
  readonly currentQuestionElapsedMs: number;
  readonly remainingSeconds: number;
  readonly updatedAt: number;
}

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
    draft: PracticeSessionDraft
  ): Promise<void> {
    const snapshot = {
      ...draft,
      answers: { ...draft.answers },
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
  const answers = stringMap(payload.answers, (questionId, optionId) => validOptions.get(questionId)?.has(optionId) === true);
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

function stringMap(
  value: unknown,
  accept: (key: string, item: string) => boolean
): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && accept(entry[0], entry[1])
  ));
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
