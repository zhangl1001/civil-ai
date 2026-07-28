import type { TutorDatabaseRuntime } from '@/composition-root/public';
import type { LocalDate } from '@/kernel/public';

export class PlanFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async load() {
    const cycle = await this.requireCycle();
    const [curriculum, plan] = await Promise.all([
      this.runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId),
      this.runtime.dailyPlanRepository.findCurrent(cycle.examCycle.id, today())
    ]);
    const weekday = new Date().getDay();
    return {
      cycleLabel: cycle.project.name,
      availableMinutes: weekday === 0 || weekday === 6
        ? cycle.studyConstraints.weekendMinutes
        : cycle.studyConstraints.weekdayMinutes,
      capabilityNames: new Map(curriculum?.capabilityNodes.map((node) => [node.id, node.name]) ?? []),
      plan
    };
  }

  async generate(availableMinutes: number) {
    const cycle = await this.requireCycle();
    const proposal = await this.runtime.buildDailyPlanProposal.execute({
      examCycleId: cycle.examCycle.id,
      availableMinutes: Math.max(5, availableMinutes),
      examDate: cycle.examCycle.examDate,
      phase: cycle.examCycle.phase
    });
    return this.runtime.persistDailyPlanProposal.execute({
      proposal,
      planDate: today(),
      phase: cycle.examCycle.phase
    });
  }

  cancel(dailyPlanItemId: string) {
    return this.runtime.updateDailyPlanItemStatus.execute({
      dailyPlanItemId,
      status: 'cancelled'
    });
  }

  private async requireCycle() {
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    return cycle;
  }
}

function today(): LocalDate {
  return new Date().toLocaleDateString('en-CA') as LocalDate;
}
