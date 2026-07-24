import type { UnitOfWork } from '@/capabilities/database/public';
import type { AgentRunId, Clock, IdGenerator, InstantMs, JsonObject } from '@/kernel/public';
import type { OutboxRepository } from '@/modules/task/public';
import type { AgentRunAggregate, AgentRunRepository } from '../contracts/AgentRunRepository';
import { AgentRunAction } from '../domain/AgentRunCodes';
import { AgentRunMachine } from '../domain/AgentRunMachine';

export interface TransitionAgentRunCommand { readonly idempotencyKey:string; readonly agentRunId:AgentRunId; readonly action:AgentRunAction; readonly reasonCode:string; readonly checkpoint?:JsonObject; readonly errorCode?:string; readonly cancellationReason?:string; readonly nextRunAt?:InstantMs; readonly payload?:JsonObject; }
export class TransitionAgentRun {
  private readonly machine=new AgentRunMachine();
  constructor(private readonly unitOfWork:UnitOfWork,private readonly repository:AgentRunRepository,private readonly outbox:OutboxRepository,private readonly clock:Clock,private readonly ids:IdGenerator) {}
  async execute(command:TransitionAgentRunCommand):Promise<AgentRunAggregate>{
    if(!command.idempotencyKey.trim()||!command.reasonCode.trim())throw new Error('Agent run transition requires idempotency key and reason code');
    const aggregate=await this.repository.findById(command.agentRunId); if(!aggregate)throw new Error(`Agent run does not exist: ${command.agentRunId}`);
    if(aggregate.events.some(event=>event.idempotencyKey===command.idempotencyKey))return aggregate;
    const now=this.clock.now(); const run=this.machine.transition(aggregate.run,command.action,this.clock,{checkpoint:command.checkpoint,errorCode:command.errorCode,cancellationReason:command.cancellationReason,nextRunAt:command.nextRunAt});
    const event={id:this.ids.next('AgentRunEventId'),agentRunId:run.id,eventType:eventType(command.action),fromStatus:aggregate.run.status,toStatus:run.status,reasonCode:command.reasonCode.trim(),payload:command.payload??{},occurredAt:now,idempotencyKey:command.idempotencyKey};
    await this.unitOfWork.run(async context=>{await this.repository.replace(run,aggregate.run.version,event,context);await this.outbox.append({id:this.ids.next('OutboxEventId'),aggregateType:'tutor_agent_run',aggregateId:run.id,eventType:`tutor_agent_run.${event.eventType}`,payload:{agentRunId:run.id,status:run.status},occurredAt:now,attemptCount:0,idempotencyKey:`${command.idempotencyKey}:outbox`},context);}); return {run,events:[...aggregate.events,event]};
  }
}
function eventType(action:AgentRunAction):'started'|'waiting_user'|'resumed'|'recovered'|'completed'|'failed'|'cancelled'{if(action===AgentRunAction.Start)return'started';if(action===AgentRunAction.WaitForUser)return'waiting_user';if(action===AgentRunAction.Resume)return'resumed';if(action===AgentRunAction.Retry)return'recovered';if(action===AgentRunAction.Complete)return'completed';if(action===AgentRunAction.Fail)return'failed';return'cancelled';}
