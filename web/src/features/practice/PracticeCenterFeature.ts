import type { TutorDatabaseRuntime } from '@/composition-root/public';
import { TaskTargetType } from '@/modules/agent/public';
import { objectiveSubjectCodes } from '@/domain/subjectDelivery';
import { CapabilityNodeType } from '@/modules/curriculum/public';
import {
  QuestionOriginType,
  QuestionSetEntryMode,
  type QuestionSetLibraryCursor,
  type QuestionSetLibraryEntry,
  type QuestionSetLibraryQuery
} from '@/modules/content/public';
import { TutorDailyPracticeFeature } from './TutorDailyPracticeFeature';
import { cancelQuestionSetRuns } from './cancelQuestionSetRuns';

/** Read model used by the practice center; generation commands remain explicit page actions. */
export class PracticeCenterFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async load(preference: {
    readonly planItemId?: string;
    readonly capabilityNodeId?: string;
    readonly module?: string;
  } = {}) {
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const [curriculum, prescription, tutorPage, selfPage, trueQuestionPage, trueQuestionFacets, runs] = await Promise.all([
      this.runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId),
      new TutorDailyPracticeFeature(this.runtime).prepare(preference),
      queryQuestionSetPage(this.runtime, {
        examCycleId: cycle.examCycle.id,
        originTypes: GENERATED_ORIGIN_TYPES,
        entryModes: [QuestionSetEntryMode.Tutor],
        limit: QUESTION_SET_PAGE_SIZE
      }),
      queryQuestionSetPage(this.runtime, {
        examCycleId: cycle.examCycle.id,
        originTypes: GENERATED_ORIGIN_TYPES,
        entryModes: [QuestionSetEntryMode.Self],
        limit: QUESTION_SET_PAGE_SIZE
      }),
      queryQuestionSetPage(this.runtime, {
        examCycleId: cycle.examCycle.id,
        originTypes: TRUE_QUESTION_ORIGIN_TYPES,
        limit: QUESTION_SET_PAGE_SIZE
      }),
      this.runtime.contentRepository.queryQuestionSetLibrary({
        examCycleId: cycle.examCycle.id,
        originTypes: TRUE_QUESTION_ORIGIN_TYPES,
        limit: TRUE_QUESTION_FACET_LIMIT
      }),
      this.runtime.getAgentRunViews.execute({ limit: 50 })
    ]);
    const curriculumNodes = (curriculum?.capabilityNodes ?? [])
      .filter((node) => node.status === 'active')
      .sort((left, right) => left.sequence - right.sequence);
    return {
      cycleName: cycle.project.name,
      examName: cycle.examCycle.examName || cycle.examCycle.examType,
      province: cycle.examCycle.province || '',
      curriculumNodes,
      // Trainable nodes are the ones this package answers with questions, which
      // is not the same as a subject called 行测.
      capabilities: curriculumNodes.filter((node) => (
        objectiveSubjectCodes().has(node.subject)
        && (node.nodeType === CapabilityNodeType.KnowledgePoint || node.nodeType === CapabilityNodeType.SubPoint)
      )),
      prescription,
      tutorPage,
      selfPage,
      trueQuestionPage,
      trueQuestionFacets,
      activeRuns: runs.filter((run) => (
        run.isActive && (
          run.targetResourceType === TaskTargetType.StructuredPractice
          || run.scopeKey?.startsWith('trueQuestionResearch:')
        )
      ))
    };
  }

  async listQuestionSetPage(
    query: Omit<QuestionSetLibraryQuery, 'examCycleId' | 'limit'> & { readonly limit?: number }
  ): Promise<QuestionSetLibraryPage> {
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return { entries: [], hasMore: false };
    return queryQuestionSetPage(this.runtime, {
      ...query,
      examCycleId: cycle.examCycle.id,
      limit: query.limit ?? QUESTION_SET_PAGE_SIZE
    });
  }

  async listQuestionSets(query?: Omit<QuestionSetLibraryQuery, 'examCycleId'>): Promise<readonly QuestionSetLibraryEntry[]> {
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    return cycle
      ? this.runtime.contentRepository.queryQuestionSetLibrary({
          examCycleId: cycle.examCycle.id,
          originTypes: query?.originTypes ?? [
            QuestionOriginType.AiGenerated,
            QuestionOriginType.AiVariant,
            QuestionOriginType.DiagnosticAnchor
          ],
          modules: query?.modules,
          practiceStatuses: query?.practiceStatuses,
          examYears: query?.examYears,
          provinces: query?.provinces,
          limit: query?.limit ?? 40
        })
      : [];
  }

  async retireQuestionSet(questionSetId: string): Promise<void> {
    const bundle = await this.runtime.contentRepository.findQuestionSet(
      questionSetId as Parameters<TutorDatabaseRuntime['contentRepository']['findQuestionSet']>[0]
    );
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!bundle || !cycle || bundle.questionSet.examCycleId !== cycle.examCycle.id) {
      throw new Error('题组不存在或不属于当前备考档案。');
    }
    await cancelQuestionSetRuns(this.runtime, questionSetId);
    await this.runtime.retireQuestionSet.execute(bundle.questionSet.id);
  }

  async resolveLearningThread(questionSetId: string): Promise<string> {
    const bundle = await this.runtime.contentRepository.findQuestionSet(
      questionSetId as Parameters<TutorDatabaseRuntime['contentRepository']['findQuestionSet']>[0]
    );
    if (!bundle) throw new Error('题组不存在或已不可用。');
    if (bundle.questionSet.learningThreadId) return bundle.questionSet.learningThreadId;
    const source = bundle.questionSet.sourceId
      ? await this.runtime.questionSourceRepository.findSource(bundle.questionSet.sourceId)
      : undefined;
    const thread = await this.runtime.startStructuredTeaching.execute({
      idempotencyKey: `practice:true-question:${bundle.questionSet.id}:${Date.now()}`,
      capabilityNodeId: bundle.questionSet.capabilityNodeId,
      goal: source?.paperName
        ? `完成${source.paperName}并将结果纳入能力分析`
        : '完成真题练习并将结果纳入能力分析',
      gapSnapshot: {
        source: 'true_question_practice',
        questionSetId: bundle.questionSet.id,
        sourceId: bundle.questionSet.sourceId ?? null
      }
    });
    return thread.thread.id;
  }
}

export interface QuestionSetLibraryPage {
  readonly entries: readonly QuestionSetLibraryEntry[];
  readonly hasMore: boolean;
  readonly nextCursor?: QuestionSetLibraryCursor;
}

const QUESTION_SET_PAGE_SIZE = 12;
const TRUE_QUESTION_FACET_LIMIT = 100;
const GENERATED_ORIGIN_TYPES = [
  QuestionOriginType.AiGenerated,
  QuestionOriginType.AiVariant,
  QuestionOriginType.DiagnosticAnchor
] as const;
const TRUE_QUESTION_ORIGIN_TYPES = [
  QuestionOriginType.Official,
  QuestionOriginType.Imported,
  QuestionOriginType.UserCreated
] as const;

async function queryQuestionSetPage(
  runtime: TutorDatabaseRuntime,
  query: QuestionSetLibraryQuery
): Promise<QuestionSetLibraryPage> {
  const pageSize = Math.min(40, Math.max(1, Math.round(query.limit)));
  const rows = await runtime.contentRepository.queryQuestionSetLibrary({
    ...query,
    limit: pageSize + 1
  });
  const entries = rows.slice(0, pageSize);
  const last = entries.at(-1);
  return {
    entries,
    hasMore: rows.length > pageSize,
    ...(last ? { nextCursor: { createdAt: last.createdAt, id: last.id } } : {})
  };
}
