import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, IdGenerator, JsonObject, LocalDate } from '@/kernel/public';
import type { DailyPlanProposal } from '@/modules/mastery/public';
import type { DailyPlanAggregate, DailyPlanRepository } from '../contracts/DailyPlanRepository';

export class PersistDailyPlanProposal {
  constructor(private readonly unitOfWork:UnitOfWork,private readonly repository:DailyPlanRepository,private readonly clock:Clock,private readonly ids:IdGenerator){}
  async execute(command:{readonly proposal:DailyPlanProposal;readonly planDate:LocalDate;readonly phase:string}):Promise<DailyPlanAggregate>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(command.planDate)||!command.phase.trim())throw new Error('Daily plan date and phase are required');
    const previous=await this.repository.findCurrent(command.proposal.examCycleId,command.planDate);const now=this.clock.now();const planId=this.ids.next('DailyPlanId');
    const aggregate:DailyPlanAggregate={plan:{id:planId,examCycleId:command.proposal.examCycleId,planDate:command.planDate,version:(previous?.plan.version??0)+1,status:'active',phase:command.phase.trim(),availableMinutes:command.proposal.availableMinutes,decisionSummary:command.proposal.rationale.join(' '),decisionFactors:{plannedMinutes:command.proposal.plannedMinutes,rationale:[...command.proposal.rationale]} as JsonObject,createdBy:'system',createdAt:now,supersedesPlanId:previous?.plan.id},items:command.proposal.items.map((item,index)=>({id:this.ids.next('DailyPlanItemId'),dailyPlanId:planId,capabilityNodeId:item.capabilityNodeId,reviewQueueItemId:item.reviewQueueItemId,itemType:item.action==='repair'?'review':item.action,sequence:index+1,targetMinutes:item.targetMinutes,targetCount:item.targetCount,exitCriteria:{targetMinutes:item.targetMinutes,targetCount:item.targetCount??null},reason:item.reasonCode,status:'pending',actualMinutes:0}))};
    await this.unitOfWork.run(context=>this.repository.replaceCurrent(aggregate,previous?.plan,context));return aggregate;
  }
}
