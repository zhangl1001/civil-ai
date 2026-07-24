import type { ErrorDiagnosisId, JsonObject } from '@/kernel/public';
import { CreateAgentRun, type AgentRunAggregate } from '@/modules/agent/public';
import type { ErrorDiagnosisRepository } from '../contracts/LearningRepositories';
import { AgentRunType } from '@/modules/agent/public';

export class RequestAiErrorDiagnosis {
  constructor(private readonly diagnoses:ErrorDiagnosisRepository,private readonly createAgentRun:CreateAgentRun) {}
  async execute(command:{idempotencyKey:string;provisionalDiagnosisId:ErrorDiagnosisId;evidenceContext:JsonObject}):Promise<AgentRunAggregate>{
    const diagnosis=await this.diagnoses.find(command.provisionalDiagnosisId);if(!diagnosis)throw new Error(`Provisional diagnosis does not exist: ${command.provisionalDiagnosisId}`);
    if(diagnosis.source!=='deterministic'||diagnosis.causeCode!=='unknown')throw new Error('AI diagnosis must start from a deterministic unknown diagnosis');
    return this.createAgentRun.execute({idempotencyKey:command.idempotencyKey,runType:AgentRunType.ErrorDiagnosis,examCycleId:diagnosis.examCycleId,learningThreadId:undefined,targetResourceType:'error_diagnosis',targetResourceId:diagnosis.id,inputSnapshot:{provisionalDiagnosisId:diagnosis.id,evidence:command.evidenceContext}});
  }
}
