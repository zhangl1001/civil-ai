import type { ProviderGateway } from '@/capabilities/ai-runtime/public';
import { InvocationValidationStatus, ModelMessageRole, ProviderGatewayError } from '@/capabilities/ai-runtime/public';
import type { UnitOfWork } from '@/capabilities/database/public';
import { sha256Json, type AgentRunId, type Clock, type IdGenerator, type JsonObject, type PromptVersionId } from '@/kernel/public';
import type { AgentRunRepository } from '../contracts/AgentRunRepository';

export interface InvokeAgentModelCommand {
  readonly agentRunId: AgentRunId;
  readonly modelRole: string;
  readonly system: string;
  readonly user: string;
  readonly promptVersionId?: PromptVersionId;
  readonly toolSchemaVersion?: string;
  readonly responseSchema?: JsonObject;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}
export interface InvokeAgentModelResult { readonly invocationId: string; readonly text: string; }

export class InvokeAgentModel {
  constructor(private readonly unitOfWork:UnitOfWork,private readonly repository:AgentRunRepository,private readonly clock:Clock,private readonly ids:IdGenerator) {}
  async execute(command:InvokeAgentModelCommand,gateway:ProviderGateway,signal?:AbortSignal):Promise<InvokeAgentModelResult>{
    const run=await this.repository.findById(command.agentRunId);if(!run||run.run.status!=='running')throw new Error(`Agent run is not active: ${command.agentRunId}`);if(!command.modelRole.trim()||!command.system.trim()||!command.user.trim())throw new Error('Agent model invocation requires role and prompt');
    signal?.throwIfAborted();const invocationId=this.ids.next('AiInvocationId');const requestHash=await sha256Json({provider:gateway.provider,model:gateway.model,system:command.system,user:command.user,responseSchema:command.responseSchema??null});const started=Number(this.clock.monotonicNowMs());
    await this.unitOfWork.run(context=>this.repository.appendInvocation({id:invocationId,agentRunId:command.agentRunId,provider:gateway.provider,model:gateway.model,modelRole:command.modelRole.trim(),promptVersionId:command.promptVersionId,toolSchemaVersion:command.toolSchemaVersion,requestHash,validationStatus:InvocationValidationStatus.Pending,createdAt:this.clock.now()},context));
    try{const response=await gateway.complete({system:command.system,messages:[{role:ModelMessageRole.User,content:command.user}],temperature:command.temperature??0.2,maxOutputTokens:command.maxOutputTokens??4000,responseSchema:command.responseSchema,requestId:invocationId},signal);await this.unitOfWork.run(async context=>{await this.repository.updateInvocationResult(invocationId,{providerRequestId:response.providerRequestId,inputTokens:response.usage.inputTokens,outputTokens:response.usage.outputTokens,latencyMs:Math.max(0,Number(this.clock.monotonicNowMs())-started),finishReason:response.finishReason},context);await this.repository.updateInvocationValidation(invocationId,InvocationValidationStatus.Valid,undefined,context);});return{invocationId,text:response.text};}
    catch(error){const code=signal?.aborted?'agent.invocation_cancelled':error instanceof ProviderGatewayError?`provider.${error.kind}`:'agent.invocation_failed';try{await this.unitOfWork.run(context=>this.repository.updateInvocationValidation(invocationId,signal?.aborted?InvocationValidationStatus.Cancelled:InvocationValidationStatus.Invalid,code,context));}catch{}throw error;}
  }
}
