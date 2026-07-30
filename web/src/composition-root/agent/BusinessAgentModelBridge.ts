import {
  ModelMessageRole,
  type ProviderGateway
} from '@/capabilities/ai-runtime/public';
import {
  leaseTokenOf,
  type AgentRunAggregate,
  type InvokeAgentModel
} from '@/modules/agent/public';
import type { GenerationIntent } from '@/services/GenerationTaskService';
import type { BusinessAgentExecutionContext } from './BusinessAgentExecutors';

type BusinessMessages = Parameters<BusinessAgentExecutionContext['complete']>[0];
type BusinessOptions = NonNullable<Parameters<BusinessAgentExecutionContext['complete']>[1]>;

export async function invokeBusinessAgentModel(command: {
  readonly run: AgentRunAggregate;
  readonly intent: GenerationIntent;
  readonly messages: BusinessMessages;
  readonly options: BusinessOptions;
  readonly gateway: ProviderGateway;
  readonly signal: AbortSignal;
  readonly invoke: InvokeAgentModel;
  readonly onDelta?: (delta: string) => void | Promise<void>;
}): Promise<string> {
  command.signal.throwIfAborted();
  const response = await command.invoke.execute({
    agentRunId: command.run.run.id,
    leaseToken: leaseTokenOf(command.run.run),
    modelRole: `business.${command.intent}`,
    system: command.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n') || '你是个人公考 AI 私教。',
    messages: command.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? ModelMessageRole.Assistant : ModelMessageRole.User,
        content: message.content
      })),
    temperature: command.options.temperature,
    maxOutputTokens: command.options.maxOutputTokens,
    responseSchema: command.options.responseSchema,
    preferStream: command.onDelta ? !command.options.responseSchema : undefined,
    onDelta: command.onDelta
  }, command.gateway, command.signal);
  command.signal.throwIfAborted();
  return response.text;
}
