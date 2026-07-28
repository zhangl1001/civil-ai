import type { TutorDatabaseRuntime } from '@/composition-root/public';
import { TaskTargetType } from '@/modules/agent/public';
import { CapabilityNodeType } from '@/modules/curriculum/public';
import {
  QuestionOriginType,
  type QuestionSetLibraryEntry,
  type QuestionSetLibraryQuery
} from '@/modules/content/public';
import { TutorDailyPracticeFeature } from './TutorDailyPracticeFeature';

/** Read model used by the practice center; generation commands remain explicit page actions. */
export class PracticeCenterFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async load(preferredPlanItemId?: string) {
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const [curriculum, prescription, generatedSets, trueQuestionSets, runs] = await Promise.all([
      this.runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId),
      new TutorDailyPracticeFeature(this.runtime).prepare(preferredPlanItemId),
      this.runtime.contentRepository.queryQuestionSetLibrary({
        examCycleId: cycle.examCycle.id,
        originTypes: [
          QuestionOriginType.AiGenerated,
          QuestionOriginType.AiVariant,
          QuestionOriginType.DiagnosticAnchor
        ],
        limit: 40
      }),
      this.runtime.contentRepository.queryQuestionSetLibrary({
        examCycleId: cycle.examCycle.id,
        originTypes: [
          QuestionOriginType.Official,
          QuestionOriginType.Imported,
          QuestionOriginType.UserCreated
        ],
        limit: 100
      }),
      this.runtime.getAgentRunViews.execute({ limit: 50 })
    ]);
    const curriculumNodes = (curriculum?.capabilityNodes ?? [])
      .filter((node) => node.status === 'active')
      .sort((left, right) => left.sequence - right.sequence);
    return {
      cycleName: cycle.project.name,
      curriculumNodes,
      capabilities: curriculumNodes.filter((node) => (
        node.subject === 'aptitude'
        && (node.nodeType === CapabilityNodeType.KnowledgePoint || node.nodeType === CapabilityNodeType.SubPoint)
      )),
      prescription,
      generatedSets,
      trueQuestionSets,
      activeRuns: runs.filter((run) => (
        run.targetResourceType === TaskTargetType.StructuredPractice && run.isActive
      ))
    };
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
