import type { CapabilityNodeId, JsonObject } from '@/kernel/public';
import { AssessmentRole } from '@/kernel/assessmentRole';
import type { CreateGenerationWorkflow } from '@/modules/content/public';
import type { GenerationAggregate } from '@/modules/content/public';
import { StartWeakeningTeaching } from './StartWeakeningTeaching';

export class RequestWeakeningPractice {
  constructor(private readonly startTeaching:StartWeakeningTeaching,private readonly createGeneration:CreateGenerationWorkflow) {}
  async execute(command:{idempotencyKey:string;requestedCount:number;difficultyMin:number;difficultyMax:number;constraints?:JsonObject;goal?:string;capabilityNodeId?:CapabilityNodeId;capabilityCode?:string}) : Promise<GenerationAggregate>{
    const thread=await this.startTeaching.execute({idempotencyKey:`${command.idempotencyKey}:thread`,goal:command.goal,capabilityNodeId:command.capabilityNodeId,capabilityCode:command.capabilityCode});
    return this.createGeneration.execute({idempotencyKey:`${command.idempotencyKey}:generation`,examCycleId:thread.thread.examCycleId,learningThreadId:thread.thread.id,capabilityNodeId:thread.thread.primaryCapabilityNodeId,assessmentRole:AssessmentRole.Practice,requestedCount:command.requestedCount,difficultyMin:command.difficultyMin,difficultyMax:command.difficultyMax,constraints:command.constraints});
  }
}
