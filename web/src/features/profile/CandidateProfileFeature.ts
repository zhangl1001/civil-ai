import type { TutorDatabaseRuntime } from '@/composition-root/public';
import type { CandidateHomeSnapshot, ProactiveLevelCode } from '@/modules/candidate/public';

export interface CandidateProfileSnapshot {
  readonly home: CandidateHomeSnapshot | null;
  readonly proactiveLevel?: ProactiveLevelCode;
}

let cachedSnapshot: CandidateProfileSnapshot | undefined;
let pendingLoad: Promise<CandidateProfileSnapshot> | undefined;

export function peekCandidateProfileSnapshot(): CandidateProfileSnapshot | undefined {
  return cachedSnapshot;
}

export class CandidateProfileFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  async load(options: { readonly refresh?: boolean } = {}): Promise<CandidateProfileSnapshot> {
    if (!options.refresh && cachedSnapshot) return cachedSnapshot;
    pendingLoad ??= Promise.all([
      this.runtime.getCandidateHome.execute(),
      this.runtime.candidateRepository.findCurrentCycle()
    ]).then(([home, cycle]) => {
      cachedSnapshot = {
        home: home || null,
        proactiveLevel: cycle?.learningPreferences.proactiveLevel
      };
      return cachedSnapshot;
    }).finally(() => {
      pendingLoad = undefined;
    });
    return pendingLoad;
  }

  async updateReminderPreferences(command: {
    readonly proactiveLevel: string;
    readonly enabled: boolean;
    readonly morningTime: string;
    readonly eveningTime: string;
  }) {
    const cycle = await this.runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return;
    await this.runtime.updateLearningPreferences.execute({
      examCycleId: cycle.examCycle.id,
      proactiveLevel: command.proactiveLevel as Parameters<TutorDatabaseRuntime['updateLearningPreferences']['execute']>[0]['proactiveLevel'],
      quietHours: command.enabled
        ? [{ start: command.eveningTime, end: command.morningTime }]
        : cycle.learningPreferences.quietHours
    });
    if (cachedSnapshot) {
      cachedSnapshot = {
        ...cachedSnapshot,
        proactiveLevel: command.proactiveLevel as ProactiveLevelCode
      };
    }
  }
}
