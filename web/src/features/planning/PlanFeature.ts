import type { TutorDatabaseRuntime } from '@/composition-root/public';
import type { ExamCycleId, LocalDate } from '@/kernel/public';
import {
  DAILY_LEARNING_LOAD_POLICY_VERSION,
  DailyPlanRebalanceReason,
  type DailyPlanAggregate
} from '@/modules/planning/public';

export class PlanFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async load() {
    const cycle = await this.requireCycle();
    const [curriculum, storedPlan] = await Promise.all([
      this.runtime.curriculumRepository.findBundle(cycle.examCycle.curriculumVersionId),
      this.runtime.dailyPlanRepository.findCurrent(cycle.examCycle.id, today())
    ]);
    const plan = await this.refreshStalePlan(storedPlan, cycle.examCycle.id);
    const weekday = new Date().getDay();
    return {
      cycleLabel: cycle.project.name,
      availableMinutes: weekday === 0 || weekday === 6
        ? cycle.studyConstraints.weekendMinutes
        : cycle.studyConstraints.weekdayMinutes,
      capabilityMeta: new Map(curriculum?.capabilityNodes.map((node) => [node.id, {
        id:node.id,
        name:node.name,
        module:node.module
      }]) ?? []),
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

  async cancel(dailyPlanItemId: string) {
    const cycle = await this.requireCycle();
    const updated = await this.runtime.updateDailyPlanItemStatus.execute({
      dailyPlanItemId,
      status: 'cancelled'
    });
    if (!updated) return undefined;
    return this.runtime.rebalanceDailyPlanAfterLearning.execute({
      examCycleId: cycle.examCycle.id,
      reason: DailyPlanRebalanceReason.UserRequested,
      sourceId: `daily-plan-item:${dailyPlanItemId}:cancelled`
    });
  }

  private async requireCycle() {
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    return cycle;
  }

  private async refreshStalePlan(plan: DailyPlanAggregate | undefined, examCycleId: ExamCycleId) {
    if (!plan || learningLoadPolicyVersion(plan) === DAILY_LEARNING_LOAD_POLICY_VERSION) return plan;
    return await this.runtime.rebalanceDailyPlanAfterLearning.execute({
      examCycleId,
      reason: DailyPlanRebalanceReason.UserRequested,
      sourceId: `planning-policy:${DAILY_LEARNING_LOAD_POLICY_VERSION}:${today()}`
    }) ?? plan;
  }
}

function learningLoadPolicyVersion(plan: DailyPlanAggregate): string {
  const load = plan.plan.decisionFactors.learningLoad;
  if (!load || typeof load !== 'object' || Array.isArray(load)) return '';
  const version = (load as Record<string, unknown>).policyVersion;
  return typeof version === 'string' ? version : '';
}

function today(): LocalDate {
  return new Date().toLocaleDateString('en-CA') as LocalDate;
}
