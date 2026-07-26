import type { ErrorDiagnosisId, JsonObject, LearningSessionId } from '@/kernel/public';
import { CreateAgentRun, TaskTargetType, type AgentRunAggregate } from '@/modules/agent/public';
import type { ErrorDiagnosisRepository } from '../contracts/LearningRepositories';
import { AgentRunType } from '@/modules/agent/public';

export class RequestAiErrorDiagnosis {
  constructor(
    private readonly diagnoses: ErrorDiagnosisRepository,
    private readonly createAgentRun: CreateAgentRun
  ) {}

  async execute(command: {
    readonly idempotencyKey: string;
    readonly sessionId: LearningSessionId;
    readonly items: readonly {
      readonly provisionalDiagnosisId: ErrorDiagnosisId;
      readonly evidenceContext: JsonObject;
    }[];
  }): Promise<AgentRunAggregate> {
    if (!command.items.length || command.items.length > 25) {
      throw new RangeError('AI diagnosis batch must contain between 1 and 25 items');
    }
    const ids = command.items.map((item) => item.provisionalDiagnosisId);
    if (new Set(ids).size !== ids.length) throw new Error('AI diagnosis batch contains duplicate diagnoses');
    const diagnoses = await this.diagnoses.findMany(ids);
    if (diagnoses.length !== ids.length) throw new Error('AI diagnosis batch contains a missing diagnosis');
    if (diagnoses.some((diagnosis) => (
      diagnosis.source !== 'deterministic'
      || diagnosis.causeCode !== 'unknown'
      || diagnosis.sessionId !== command.sessionId
    ))) {
      throw new Error('AI diagnosis batch must contain deterministic unknown diagnoses from one session');
    }
    const examCycleId = diagnoses[0]!.examCycleId;
    if (diagnoses.some((diagnosis) => diagnosis.examCycleId !== examCycleId)) {
      throw new Error('AI diagnosis batch must belong to one exam cycle');
    }
    return this.createAgentRun.execute({
      idempotencyKey: command.idempotencyKey,
      runType: AgentRunType.ErrorDiagnosis,
      examCycleId,
      learningThreadId: undefined,
      targetResourceType: TaskTargetType.ErrorDiagnosisBatch,
      targetResourceId: command.sessionId,
      inputSnapshot: {
        title: 'AI 错因分析',
        detail: `分析本组 ${command.items.length} 道错题`,
        diagnosisCount: command.items.length,
        items: command.items.map((item) => ({
          provisionalDiagnosisId: item.provisionalDiagnosisId,
          evidence: item.evidenceContext
        }))
      }
    });
  }
}
