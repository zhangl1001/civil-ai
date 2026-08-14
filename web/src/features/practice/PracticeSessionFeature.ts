import type { TutorDatabaseRuntime } from '@/composition-root/public';
import {
  findQuestionSetEnrichmentNeeds,
  hasQuestionSetEnrichmentNeeds,
  LearningAssetKind,
  QuestionSetStatus,
  type CommittedQuestionSetBundle,
  type QuestionSetSourceSummary
} from '@/modules/content/public';
import type { ObjectiveSessionReview } from '@/modules/evidence/public';
import { isAssessmentRole, type AssessmentRole } from '@/kernel/public';

export interface PracticeManifestSection {
  readonly bundle: CommittedQuestionSetBundle;
  readonly learningThreadId: string;
  readonly module: string;
}

export interface PracticeSessionLoadResult {
  readonly bundle: CommittedQuestionSetBundle;
  readonly manifestSections: readonly PracticeManifestSection[];
  readonly durationMinutes: number;
  readonly capabilityName: string;
  readonly previousReviews: readonly ObjectiveSessionReview[];
  readonly sourceMetadata?: QuestionSetSourceSummary;
  readonly assessmentRoleOverride?: AssessmentRole;
}

/** Read model for entering or restoring an objective practice page. */
export class PracticeSessionFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async load(input: { readonly questionSetId?: string; readonly manifestId?: string }): Promise<PracticeSessionLoadResult> {
    if (!input.questionSetId && !input.manifestId) throw new Error('题组参数缺失。');
    const manifest = input.manifestId
      ? await this.loadManifest(input.manifestId)
      : undefined;
    const singleBundle = input.questionSetId
      ? await this.runtime.contentRepository.findQuestionSet(
        input.questionSetId as Parameters<TutorDatabaseRuntime['contentRepository']['findQuestionSet']>[0]
      )
      : undefined;
    const bundle = manifest?.bundle ?? singleBundle;
    if (!bundle || bundle.questionSet.status !== QuestionSetStatus.Ready) {
      throw new Error('题组不存在或已不可用。');
    }

    const [cycle, source] = await Promise.all([
      this.runtime.candidateRepository.findCurrentCycle(),
      bundle.questionSet.sourceId
        ? this.runtime.questionSourceRepository.findSource(bundle.questionSet.sourceId)
        : undefined
    ]);
    const curriculum = cycle
      ? await this.runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId)
      : undefined;
    const targetSetIds = manifest
      ? manifest.sections.map((section) => section.bundle.questionSet.id)
      : [bundle.questionSet.id];
    // The committed question stem and options are the critical path for entering
    // practice. Enrichment may generate lectures and explanations, but it must
    // never delay the first question render.
    void Promise.all(targetSetIds.map((questionSetId) => (
      this.runtime.ensureQuestionSetEnrichment.execute({ questionSetId })
    ))).catch((error: unknown) => {
      console.warn('[PracticeSessionFeature] failed to schedule question-set enrichment', error);
    });
    const previousSessions = manifest?.restorePrevious === false
      ? []
      : (await Promise.all(
        targetSetIds.map((questionSetId) => this.runtime.learningSessionRepository.listByQuestionSet(questionSetId, 1))
      )).flat();
    const previousReviews = (await Promise.all(
      previousSessions.map((previous) => this.runtime.getObjectiveSessionReview.execute(previous.session.id))
    )).filter((review): review is ObjectiveSessionReview => Boolean(review));

    return {
      bundle,
      manifestSections: manifest?.sections ?? [],
      durationMinutes: manifest?.durationMinutes
        || finitePositiveNumber(bundle.generationSpec.constraints.durationMinutes)
        || Math.max(5, Math.ceil(bundle.questionSet.questionCount * 1.5)),
      capabilityName: manifest?.capabilityName || (
        curriculum?.capabilityNodes.find(
          (node) => node.id === bundle.questionSet.capabilityNodeId
        )?.name ?? ''
      ),
      previousReviews,
      sourceMetadata: source ? {
        sourceType: source.sourceType,
        provider: source.provider,
        examType: source.examType,
        examYear: source.examYear,
        province: source.province,
        examBatch: source.examBatch,
        paperName: source.paperName,
        sectionName: source.sectionName
      } : undefined,
      assessmentRoleOverride: manifest?.assessmentRoleOverride
    };
  }

  async waitForCompleteContent(
    questionSetIds: readonly string[],
    options: {
      readonly timeoutMs?: number;
      readonly signal?: AbortSignal;
      readonly onUpdate?: (bundles: readonly CommittedQuestionSetBundle[]) => void;
    } = {}
  ): Promise<readonly CommittedQuestionSetBundle[]> {
    const ids = [...new Set(questionSetIds.map((id) => id.trim()).filter(Boolean))];
    if (!ids.length) return [];
    const timeoutMs = Math.max(10_000, options.timeoutMs ?? 240_000);
    const deadline = Date.now() + timeoutMs;
    let poll = 0;
    let lastContentVersion = '';
    while (Date.now() < deadline) {
      options.signal?.throwIfAborted();
      const bundles = await Promise.all(ids.map((id) => (
        this.runtime.contentRepository.findQuestionSet(
          id as Parameters<TutorDatabaseRuntime['contentRepository']['findQuestionSet']>[0]
        )
      )));
      if (bundles.some((item) => !item)) throw new Error('题组在解析补全过程中不可用。');
      const available = bundles.filter((item): item is CommittedQuestionSetBundle => Boolean(item));
      const contentVersion = available
        .map((item) => `${item.questionSet.id}:${item.questionSet.contentVersion}`)
        .join('|');
      if (contentVersion !== lastContentVersion) {
        lastContentVersion = contentVersion;
        options.onUpdate?.(available);
      }
      if (available.every((item) => !hasQuestionSetEnrichmentNeeds(
        findQuestionSetEnrichmentNeeds(item)
      ))) {
        return available;
      }
      if (poll % 8 === 0) {
        await Promise.all(available.map((item) => (
          this.runtime.ensureQuestionSetEnrichment.execute({
            questionSetId: item.questionSet.id
          })
        )));
      }
      poll += 1;
      await delay(500, options.signal);
    }
    throw new Error('答案已保存，但解析补全暂未完成，请点击重试。');
  }

  private async loadManifest(manifestId: string): Promise<{
    readonly bundle: CommittedQuestionSetBundle;
    readonly sections: readonly PracticeManifestSection[];
    readonly durationMinutes: number;
    readonly capabilityName: string;
    readonly restorePrevious: boolean;
    readonly assessmentRoleOverride?: AssessmentRole;
  }> {
    const manifest = await this.runtime.learningAssetStore.find(manifestId);
    if (
      !manifest
      || (manifest.kind !== LearningAssetKind.MockManifest && manifest.kind !== LearningAssetKind.PracticeManifest)
    ) {
      throw new Error('练习清单不存在或已不可用。');
    }
    const rawSections = Array.isArray(manifest.payload.sections) ? manifest.payload.sections : [];
    const loaded = await Promise.all(rawSections.map(async (raw) => {
      const section = recordValue(raw);
      const questionSetId = textValue(section.questionSetId);
      const learningThreadId = textValue(section.learningThreadId);
      const bundle = questionSetId
        ? await this.runtime.contentRepository.findQuestionSet(
          questionSetId as Parameters<TutorDatabaseRuntime['contentRepository']['findQuestionSet']>[0]
        )
        : undefined;
      const questionIds = stringArray(section.questionIds);
      const selectedBundle = bundle && questionIds.length ? selectQuestionSubset(bundle, questionIds) : bundle;
      return selectedBundle && learningThreadId
        ? { bundle: selectedBundle, learningThreadId, module: textValue(section.module) || selectedBundle.questionSet.module }
        : undefined;
    }));
    const sections = loaded.filter((item): item is PracticeManifestSection => Boolean(item));
    if (!sections.length) throw new Error('模考清单内没有可用题组。');
    return {
      bundle: mergeQuestionBundles(
        sections.map((section) => section.bundle),
        textValue(manifest.payload.module)
      ),
      sections,
      durationMinutes: finitePositiveNumber(manifest.payload.durationMinutes),
      capabilityName: textValue(manifest.payload.capabilityName)
        || (manifest.kind === LearningAssetKind.PracticeManifest ? '错题重做' : ''),
      restorePrevious: typeof manifest.payload.restorePrevious === 'boolean'
        ? manifest.payload.restorePrevious
        : manifest.kind !== LearningAssetKind.PracticeManifest,
      assessmentRoleOverride: isAssessmentRole(manifest.payload.assessmentRole)
        ? manifest.payload.assessmentRole
        : undefined
    };
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const complete = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = globalThis.setTimeout(complete, ms);
    const abort = () => {
      globalThis.clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function selectQuestionSubset(
  bundle: CommittedQuestionSetBundle,
  questionIds: readonly string[]
): CommittedQuestionSetBundle {
  const requested = new Set(questionIds);
  if (requested.size !== questionIds.length) throw new Error('练习清单包含重复题目。');
  const byId = new Map(bundle.questions.map((question) => [String(question.id), question]));
  const questions = questionIds.map((id) => byId.get(id));
  if (questions.some((question) => !question)) throw new Error('练习清单中的部分题目已不可用。');
  return {
    ...bundle,
    questions: questions as CommittedQuestionSetBundle['questions'],
    capabilityLinks: bundle.capabilityLinks.filter((link) => requested.has(String(link.questionId))),
    questionSet: { ...bundle.questionSet, questionCount: questions.length }
  };
}

function mergeQuestionBundles(
  values: readonly CommittedQuestionSetBundle[],
  module?: string
): CommittedQuestionSetBundle {
  const first = values[0];
  if (!first) throw new Error('模考题组为空。');
  const questions = values.flatMap((value) => value.questions);
  return {
    ...first,
    documents: [],
    lectures: [],
    lectureLinks: [],
    questions,
    capabilityLinks: values.flatMap((value) => value.capabilityLinks),
    questionSet: {
      ...first.questionSet,
      module: module?.trim() || '行测模考',
      questionCount: questions.length
    }
  };
}

function finitePositiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
}
