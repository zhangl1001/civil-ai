import type { AssessmentRole, CapabilityNodeId, JsonObject } from '@/kernel/public';
import { AssessmentRole as AssessmentRoleCode } from '@/kernel/assessmentRole';
import type { CreateGenerationWorkflow } from '@/modules/content/public';
import type { GenerationAggregate } from '@/modules/content/public';
import { StartStructuredTeaching } from './StartStructuredTeaching';

export class RequestStructuredPractice {
  constructor(private readonly startTeaching:StartStructuredTeaching,private readonly createGeneration:CreateGenerationWorkflow) {}
  async execute(command:{idempotencyKey:string;requestedCount:number;difficultyMin:number;difficultyMax:number;assessmentRole?:AssessmentRole;constraints?:JsonObject;goal?:string;capabilityNodeId?:CapabilityNodeId;capabilityCode?:string}) : Promise<GenerationAggregate>{
    const thread=await this.startTeaching.execute({idempotencyKey:`${command.idempotencyKey}:thread`,goal:command.goal,capabilityNodeId:command.capabilityNodeId,capabilityCode:command.capabilityCode});
    return this.createGeneration.execute({idempotencyKey:`${command.idempotencyKey}:generation`,examCycleId:thread.thread.examCycleId,learningThreadId:thread.thread.id,capabilityNodeId:thread.thread.primaryCapabilityNodeId,assessmentRole:command.assessmentRole??AssessmentRoleCode.Practice,requestedCount:command.requestedCount,difficultyMin:command.difficultyMin,difficultyMax:command.difficultyMax,constraints:command.constraints});
  }
}
