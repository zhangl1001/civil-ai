import type { UnitOfWork } from '@/capabilities/database/public';
import type {
  AgentRunId,
  Clock,
  ErrorDiagnosisId,
  IdGenerator,
  LearningSessionId
} from '@/kernel/public';
import type { ErrorDiagnosisRepository } from '@/modules/evidence/public';
import { ErrorCauseCode } from '@/modules/evidence/public';
import type { TutorCycleRepository } from '../contracts/TutorCycleRepository';

export class FinalizeObjectiveTutorConclusion {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly conclusions: TutorCycleRepository,
    private readonly diagnoses: ErrorDiagnosisRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: {
    readonly agentRunId: AgentRunId;
    readonly sessionId: LearningSessionId;
    readonly diagnosisIds: readonly ErrorDiagnosisId[];
  }) {
    const idempotencyKey = `${command.sessionId}:diagnosis:${command.agentRunId}:tutor-conclusion:v1`;
    const existing = await this.conclusions.findByIdempotencyKey(idempotencyKey);
    if (existing) return existing;
    const [base, records] = await Promise.all([
      this.conclusions.findLatestBySession(command.sessionId),
      this.diagnoses.findMany(command.diagnosisIds)
    ]);
    if (!base) throw new Error(`Tutor conclusion does not exist for session ${command.sessionId}`);
    const applicable = records.filter((item) => (
      item.sessionId === command.sessionId && item.source === 'tutor_ai'
    ));
    if (!applicable.length) throw new Error('Completed AI diagnosis has no applicable diagnosis records');

    const conclusion = {
      ...base,
      id: this.ids.next('TutorCycleConclusionId'),
      diagnosis: {
        ...base.diagnosis,
        status: 'available',
        knownCauseCodes: [...new Set(applicable
          .filter((item) => item.causeCode !== ErrorCauseCode.Unknown)
          .map((item) => item.causeCode))],
        diagnosisIds: applicable.map((item) => item.id),
        pendingDiagnosisRunIds: [],
        finalizedByAgentRunId: command.agentRunId,
        supersedesConclusionId: base.id
      },
      idempotencyKey,
      createdAt: this.clock.now()
    };
    await this.unitOfWork.run((context) => this.conclusions.append(conclusion, context));
    return conclusion;
  }
}
