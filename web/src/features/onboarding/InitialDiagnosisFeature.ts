import type { TutorDatabaseRuntime } from '@/composition-root/public';
import { AssessmentRole } from '@/kernel/public';
import { QuestionSetEntryMode } from '@/modules/content/public';
import { StructuredPracticeTaskCenter } from '@/features/practice/StructuredPracticeTaskCenter';
import { selectCoverageGapCapability } from '@/features/practice/CapabilitySelection';

export class InitialDiagnosisFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async start() {
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return undefined;
    const [curriculum, tracks] = await Promise.all([
      this.runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId),
      this.runtime.masteryRepository.listTracks(cycle.examCycle.id, 100)
    ]);
    const capability = selectCoverageGapCapability(curriculum?.capabilityNodes ?? [], tracks);
    if (!capability) throw new Error('当前考试大纲没有可用于诊断的能力节点。');
    const scopeKey = `diagnosis:${cycle.examCycle.id}:${capability.id}`;
    await new StructuredPracticeTaskCenter(this.runtime).start({
      idempotencyKey: `${scopeKey}:${Date.now()}`,
      scopeKey,
      title: `初始诊断 · ${capability.name}`,
      detail: '用锚定题建立第一份真实能力证据',
      entryMode: QuestionSetEntryMode.Tutor,
      source: 'diagnosis',
      capabilityNodeId: capability.id,
      capabilityCode: capability.code,
      capabilityName: capability.name,
      module: capability.module,
      assessmentRole: AssessmentRole.Anchor,
      requestedCount: 8,
      difficultyMin: 0.3,
      difficultyMax: 0.72,
      goal: `确认考生在${capability.name}上的真实起点`
    });
    return { scopeKey, capabilityNodeId: capability.id };
  }
}
