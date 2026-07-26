import type { CandidateRepository } from '@/modules/candidate/public';
import type { CurriculumRepository } from '@/modules/curriculum/public';
import type { CapabilityNodeId, JsonObject } from '@/kernel/public';
import { CreateLearningThread } from './CreateLearningThread';
import { LearningThreadOrigin } from '../domain/LearningThreadCodes';
import { LearningThreadStage } from '../domain/LearningThreadStage';

/** First vertical-slice adapter. Pages supply intent, never raw cycle/capability IDs. */
export class StartStructuredTeaching {
  constructor(private readonly candidates:CandidateRepository,private readonly curriculum:CurriculumRepository,private readonly createThread:CreateLearningThread) {}
  async execute(command:{idempotencyKey:string;goal?:string;gapSnapshot?:JsonObject;capabilityNodeId?:CapabilityNodeId;capabilityCode?:string}){
    const cycle=await this.candidates.findCurrentCycle();if(!cycle)throw new Error('请先完成备考档案并创建考试周期');
    const bundle=await this.curriculum.findBundle(cycle.examCycle.curriculumVersionId);
    const targetCode=command.capabilityCode?.trim();
    if(!command.capabilityNodeId&&!targetCode)throw new Error('必须明确指定本次教学的能力节点');
    const capability=bundle?.capabilityNodes.find(node=>node.status==='active'&&(command.capabilityNodeId?node.id===command.capabilityNodeId:node.code===targetCode));
    if(!capability)throw new Error(`当前大纲缺少能力节点：${command.capabilityNodeId||targetCode}`);
    return this.createThread.execute({idempotencyKey:command.idempotencyKey,examCycleId:cycle.examCycle.id,capabilityNodeId:capability.id,originType:LearningThreadOrigin.UserRequest,goal:command.goal?.trim()||`掌握${capability.name}的核心概念、方法和典型题型`,gapSnapshot:command.gapSnapshot??{source:'user_requested',capabilityCode:capability.code,capabilityName:capability.name},initialStage:LearningThreadStage.Diagnose,exitCriteria:{minimumIndependentAttempts:3,minimumRetentionAttempts:2,minimumTransferAttempts:1}});
  }
}
