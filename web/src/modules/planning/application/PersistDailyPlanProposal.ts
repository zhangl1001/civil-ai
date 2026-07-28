import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, IdGenerator, JsonObject, LocalDate } from '@/kernel/public';
import type { DailyPlanProposal } from '@/modules/mastery/public';
import type { DailyPlanAggregate, DailyPlanItemRecord, DailyPlanRepository } from '../contracts/DailyPlanRepository';
import { DailyPlanItemStatus, DailyPlanItemType, DailyPlanStatus } from '../domain/DailyPlanCodes';

export class PersistDailyPlanProposal {
  constructor(private readonly unitOfWork:UnitOfWork,private readonly repository:DailyPlanRepository,private readonly clock:Clock,private readonly ids:IdGenerator){}
  async execute(command:{
    readonly proposal:DailyPlanProposal;
    readonly planDate:LocalDate;
    readonly phase:string;
    readonly retainTerminalItems?:boolean;
    readonly availableMinutes?:number;
    readonly decisionFactors?:JsonObject;
  }):Promise<DailyPlanAggregate>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(command.planDate)||!command.phase.trim())throw new Error('Daily plan date and phase are required');
    const previous=await this.repository.findCurrent(command.proposal.examCycleId,command.planDate);const now=this.clock.now();const planId=this.ids.next('DailyPlanId');
    const retained = command.retainTerminalItems && previous
      ? previous.items.filter(isTerminal).map((item, index) => copyItem(item, planId, index + 1, this.ids))
      : [];
    const proposed = command.proposal.items.map((item,index):DailyPlanItemRecord=>({
      id:this.ids.next('DailyPlanItemId'),
      dailyPlanId:planId,
      capabilityNodeId:item.capabilityNodeId,
      reviewQueueItemId:item.reviewQueueItemId,
      itemType:item.action==='repair'?DailyPlanItemType.Review:item.action,
      sequence:retained.length+index+1,
      targetMinutes:item.targetMinutes,
      targetCount:item.targetCount,
      exitCriteria:{targetMinutes:item.targetMinutes,targetCount:item.targetCount??null},
      reason:item.reasonCode,
      status:DailyPlanItemStatus.Pending,
      actualMinutes:0
    }));
    const aggregate:DailyPlanAggregate={plan:{id:planId,examCycleId:command.proposal.examCycleId,planDate:command.planDate,version:(previous?.plan.version??0)+1,status:DailyPlanStatus.Active,phase:command.phase.trim(),availableMinutes:command.availableMinutes??command.proposal.availableMinutes,decisionSummary:command.proposal.rationale.join(' ')||'已根据最新学习结果调整剩余安排。',decisionFactors:{plannedMinutes:command.proposal.plannedMinutes,rationale:[...command.proposal.rationale],learningLoad:command.proposal.learningLoad,...(command.decisionFactors??{})} as unknown as JsonObject,createdBy:'system',createdAt:now,supersedesPlanId:previous?.plan.id},items:[...retained,...proposed]};
    await this.unitOfWork.run(context=>this.repository.replaceCurrent(aggregate,previous?.plan,context));return aggregate;
  }
}

function isTerminal(item:DailyPlanItemRecord):boolean {
  return item.status===DailyPlanItemStatus.Completed||item.status===DailyPlanItemStatus.Skipped||item.status===DailyPlanItemStatus.Cancelled;
}

function copyItem(item:DailyPlanItemRecord,planId:string,sequence:number,ids:IdGenerator):DailyPlanItemRecord {
  return {...item,id:ids.next('DailyPlanItemId'),dailyPlanId:planId,sequence};
}
