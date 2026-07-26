import type { TutorDatabaseRuntime } from '@/composition-root/public';
import { TaskTargetType } from '@/modules/agent/public';
import { CapabilityNodeType } from '@/modules/curriculum/public';
import { TutorDailyPracticeFeature } from './TutorDailyPracticeFeature';

/** Read model used by the practice center; generation commands remain explicit page actions. */
export class PracticeCenterFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async load(preferredPlanItemId?: string) {
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    const [curriculum, prescription, sets, runs] = await Promise.all([
      this.runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId),
      new TutorDailyPracticeFeature(this.runtime).prepare(preferredPlanItemId),
      this.runtime.contentRepository.listQuestionSets(cycle.examCycle.id, 40),
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
      sets,
      activeRuns: runs.filter((run) => (
        run.targetResourceType === TaskTargetType.StructuredPractice && run.isActive
      ))
    };
  }

  async listQuestionSets() {
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    return cycle
      ? this.runtime.contentRepository.listQuestionSets(cycle.examCycle.id, 40)
      : [];
  }
}
