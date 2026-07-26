import { appLifecycleAdapter } from '@/platform/AppLifecycleAdapter';
import { DailyPlanRebalanceReason } from '@/modules/planning/public';
import type { TutorDatabaseRuntime } from '../database/createTutorDatabaseRuntime';
import { tutorDatabaseLifecycleCoordinator } from '../database/TutorDatabaseLifecycleCoordinator';

const MIN_EVALUATION_INTERVAL_MS = 60_000;

export class ProactiveTutorCoordinator {
  private runtime?: TutorDatabaseRuntime;
  private evaluation?: Promise<void>;
  private lastEvaluatedAt = 0;
  private removeActiveListener?: () => void;

  install(runtime: TutorDatabaseRuntime): void {
    this.runtime = runtime;
    if (!this.removeActiveListener) {
      this.removeActiveListener = appLifecycleAdapter.onActive(() => this.start());
    }
    this.start(true);
  }

  start(force = false): void {
    if (!this.runtime || this.evaluation) return;
    if (!force && Date.now() - this.lastEvaluatedAt < MIN_EVALUATION_INTERVAL_MS) return;
    this.evaluation = this.run(this.runtime)
      .catch((error: unknown) => console.warn('[ProactiveTutorCoordinator] evaluation paused', error))
      .finally(() => { this.evaluation = undefined; });
  }

  private async run(runtime: TutorDatabaseRuntime): Promise<void> {
    await tutorDatabaseLifecycleCoordinator.waitUntilReady();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return;
    const date = localDate(Date.now(), cycle.examCycle.timeZone);
    const plan = await runtime.dailyPlanRepository.findCurrent(cycle.examCycle.id, date);
    const latestCompleted = [...(plan?.items ?? [])].reverse().find((item) => item.status === 'completed');
    const sourceId = typeof latestCompleted?.resultSummary?.sessionId === 'string'
      ? latestCompleted.resultSummary.sessionId
      : undefined;
    const usedMinutes = (plan?.items ?? [])
      .filter((item) => item.status === 'completed')
      .reduce((total, item) => total + Math.max(1, item.actualMinutes), 0);
    const hasReplanBudget = Boolean(plan && plan.plan.availableMinutes - usedMinutes >= 5);
    if (sourceId && hasReplanBudget && plan?.plan.decisionFactors.sourceId !== sourceId) {
      await runtime.rebalanceDailyPlanAfterLearning.execute({
        examCycleId: cycle.examCycle.id,
        reason: DailyPlanRebalanceReason.LearningResult,
        sourceId
      });
    }
    await runtime.evaluateProactiveSignals.execute(cycle.examCycle.id);
    await runtime.deliverProactiveSignals.execute(cycle.examCycle.id);
    this.lastEvaluatedAt = Date.now();
  }
}

export const proactiveTutorCoordinator = new ProactiveTutorCoordinator();

function localDate(now:number,timeZone:string) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}` as Parameters<TutorDatabaseRuntime['dailyPlanRepository']['findCurrent']>[1];
}
