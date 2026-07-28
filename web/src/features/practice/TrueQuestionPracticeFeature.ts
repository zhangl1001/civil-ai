import type { TutorDatabaseRuntime } from '@/composition-root/public';
import { AssessmentRole, type JsonObject } from '@/kernel/public';
import {
  LearningAssetKind,
  QuestionOriginType,
  QuestionSetPracticeStatus,
  questionSourceTitle,
  type CommittedQuestionSetBundle,
  type QuestionOriginTypeCode
} from '@/modules/content/public';
import { practiceModuleLabel } from '@/domain/labels';

export interface TrueQuestionPracticeRequest {
  readonly mode: 'special' | 'retest';
  readonly originType?: QuestionOriginTypeCode;
  readonly module?: string;
  readonly examYear?: number;
  readonly province?: string;
  readonly count: number;
}

/** Builds a temporary practice manifest from existing true questions without duplicating question content. */
export class TrueQuestionPracticeFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async start(request: TrueQuestionPracticeRequest): Promise<string> {
    if (!Number.isInteger(request.count) || request.count < 1 || request.count > 30) {
      throw new RangeError('真题专项单次题量必须在 1 到 30 题之间。');
    }
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const entries = await this.runtime.contentRepository.queryQuestionSetLibrary({
      examCycleId: cycle.examCycle.id,
      originTypes: request.originType
        ? [request.originType]
        : [QuestionOriginType.Official, QuestionOriginType.Imported, QuestionOriginType.UserCreated],
      modules: request.module ? [request.module] : undefined,
      practiceStatuses: request.mode === 'retest'
        ? [QuestionSetPracticeStatus.Completed]
        : undefined,
      examYears: request.examYear ? [request.examYear] : undefined,
      provinces: request.province ? [request.province] : undefined,
      limit: 100
    });
    if (!entries.length) {
      throw new Error(request.mode === 'retest'
        ? '当前筛选范围内还没有已完成的真题。'
        : '当前筛选范围内没有可练习的真题。');
    }

    const bundles = (await Promise.all(entries.map((entry) => (
      this.runtime.contentRepository.findQuestionSet(entry.id)
    )))).filter((bundle): bundle is CommittedQuestionSetBundle => Boolean(bundle));
    const selected = selectQuestions(bundles, request.count);
    if (!selected.length) throw new Error('当前真题题组没有可用题目。');
    const sections = await Promise.all(selected.map(async ({ bundle, questionIds }) => ({
      questionSetId: bundle.questionSet.id,
      learningThreadId: await this.resolveThread(bundle),
      module: bundle.questionSet.module,
      questionIds
    })));
    const actualCount = sections.reduce((sum, section) => sum + section.questionIds.length, 0);
    const module = request.module || commonModule(bundles) || 'aptitude';
    const modeLabel = request.mode === 'retest' ? '真题复测' : '真题专项';
    const sourceLabel = questionSourceTitle(entries[0]?.sourceMetadata);
    const createdAt = Date.now();
    const manifest = await this.runtime.learningAssetStore.save({
      examCycleId: cycle.examCycle.id,
      kind: LearningAssetKind.PracticeManifest,
      businessKey: `true-question:${request.mode}:${createdAt}:${entries[0]!.id}`,
      title: `${modeLabel} · ${actualCount}题`,
      payload: asJson({
        manifestType: request.mode === 'retest' ? 'true_question_retest' : 'true_question_special',
        capabilityName: sourceLabel || modeLabel,
        module,
        assessmentRole: request.mode === 'retest' ? AssessmentRole.Transfer : AssessmentRole.Anchor,
        durationMinutes: Math.max(5, Math.ceil(actualCount * 1.5)),
        questionCount: actualCount,
        restorePrevious: false,
        sections
      })
    });
    return manifest.id;
  }

  private async resolveThread(bundle: CommittedQuestionSetBundle): Promise<string> {
    if (bundle.questionSet.learningThreadId) return bundle.questionSet.learningThreadId;
    const source = bundle.questionSet.sourceId
      ? await this.runtime.questionSourceRepository.findSource(bundle.questionSet.sourceId)
      : undefined;
    const thread = await this.runtime.startStructuredTeaching.execute({
      idempotencyKey: `practice:true-question:${bundle.questionSet.id}:${Date.now()}`,
      capabilityNodeId: bundle.questionSet.capabilityNodeId,
      goal: source?.paperName
        ? `完成${source.paperName}并将结果纳入能力分析`
        : `完成${practiceModuleLabel(bundle.questionSet.module)}真题并将结果纳入能力分析`,
      gapSnapshot: {
        source: 'true_question_practice',
        questionSetId: bundle.questionSet.id,
        sourceId: bundle.questionSet.sourceId ?? null
      }
    });
    return thread.thread.id;
  }
}

function selectQuestions(
  bundles: readonly CommittedQuestionSetBundle[],
  limit: number
): readonly { readonly bundle: CommittedQuestionSetBundle; readonly questionIds: readonly string[] }[] {
  const selected = new Map<string, { bundle: CommittedQuestionSetBundle; questionIds: string[] }>();
  const queues = bundles.map((bundle) => ({
    bundle,
    questions: [...bundle.questions].sort((left, right) => left.sequence - right.sequence)
  }));
  let cursor = 0;
  while (cursor < limit && queues.some((queue) => queue.questions.length)) {
    for (const queue of queues) {
      const question = queue.questions.shift();
      if (!question) continue;
      const section = selected.get(queue.bundle.questionSet.id) ?? {
        bundle: queue.bundle,
        questionIds: []
      };
      section.questionIds.push(question.id);
      selected.set(queue.bundle.questionSet.id, section);
      cursor += 1;
      if (cursor >= limit) break;
    }
  }
  return [...selected.values()];
}

function commonModule(bundles: readonly CommittedQuestionSetBundle[]): string {
  const modules = new Set(bundles.map((bundle) => bundle.questionSet.module));
  return modules.size === 1 ? [...modules][0]! : '';
}

function asJson(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
