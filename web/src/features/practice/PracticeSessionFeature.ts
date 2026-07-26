import type { TutorDatabaseRuntime } from '@/composition-root/public';
import {
  LearningAssetKind,
  type CommittedQuestionSetBundle
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
    if (!bundle) throw new Error('题组不存在或已不可用。');

    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    const curriculum = cycle
      ? await this.runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId)
      : undefined;
    const targetSetIds = manifest
      ? manifest.sections.map((section) => section.bundle.questionSet.id)
      : [bundle.questionSet.id];
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
      assessmentRoleOverride: manifest?.assessmentRoleOverride
    };
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
      bundle: mergeQuestionBundles(sections.map((section) => section.bundle)),
      sections,
      durationMinutes: finitePositiveNumber(manifest.payload.durationMinutes),
      capabilityName: textValue(manifest.payload.capabilityName)
        || (manifest.kind === LearningAssetKind.PracticeManifest ? '错题重做' : ''),
      restorePrevious: manifest.kind !== LearningAssetKind.PracticeManifest,
      assessmentRoleOverride: isAssessmentRole(manifest.payload.assessmentRole)
        ? manifest.payload.assessmentRole
        : undefined
    };
  }
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

function mergeQuestionBundles(values: readonly CommittedQuestionSetBundle[]): CommittedQuestionSetBundle {
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
    questionSet: { ...first.questionSet, module: '行测模考', questionCount: questions.length }
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
