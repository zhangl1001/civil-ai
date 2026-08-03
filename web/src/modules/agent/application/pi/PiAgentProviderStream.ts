import type { ProviderGateway, ProviderResponse } from '@/capabilities/ai-runtime/public';
import type { AgentModelInvoker } from '../../contracts/AgentRuntimePorts';
import type { RunAgentLoopCommand } from '../AgentLoopContracts';
import { toProviderMessages } from './PiAgentMessageAdapter';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Api,
  type Model,
  type Usage
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';

export interface PiProviderStreamOptions {
  readonly command: RunAgentLoopCommand;
  readonly gateway: ProviderGateway;
  readonly invoker: AgentModelInvoker;
  readonly toolChoice: () => 'auto' | 'none' | 'required' | { readonly name: string };
  readonly onError?: (error: unknown) => void;
}

export function createPiProviderModel(gateway: ProviderGateway, maxContextTokens: number): Model<Api> {
  return {
    id: gateway.model,
    name: gateway.model,
    api: 'tutor-provider',
    provider: gateway.provider,
    baseUrl: '',
    reasoning: true,
    input: gateway.capabilities.multimodalInput ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: maxContextTokens,
    maxTokens: 4_096
  };
}

export function createPiProviderStream(options: PiProviderStreamOptions): StreamFn {
  return (_model, context, streamOptions) => {
    const stream = createAssistantMessageEventStream();
    void produceProviderEvents(stream, options, context, streamOptions?.signal);
    return stream;
  };
}

async function produceProviderEvents(
  stream: AssistantMessageEventStream,
  options: PiProviderStreamOptions,
  context: Parameters<StreamFn>[1],
  signal?: AbortSignal
): Promise<void> {
  let text = '';
  let textStarted = false;
  let partial = createAssistantMessage(options.gateway);
  stream.push({ type: 'start', partial });
  try {
    const response = await options.invoker.invoke({
      agentRunId: options.command.agentRunId,
      leaseToken: options.command.executionContext.leaseToken,
      modelRole: 'agent.tutor_turn',
      system: context.systemPrompt || '',
      messages: toProviderMessages(context.messages),
      temperature: 0.2,
      maxOutputTokens: 4_096,
      tools: (context.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters as unknown as import('@/kernel/public').JsonObject
      })),
      toolChoice: options.toolChoice(),
      toolSchemaVersion: 'tutor-tools@2',
      preferStream: options.command.preferStream !== false,
      onDelta: (delta) => {
        if (!delta) return;
        if (!textStarted) {
          textStarted = true;
          partial = withText(partial, text);
          stream.push({ type: 'text_start', contentIndex: 0, partial });
        }
        text += delta;
        partial = withText(partial, text);
        stream.push({ type: 'text_delta', contentIndex: 0, delta, partial });
      }
    }, options.gateway, signal);
    ({ text, textStarted, partial } = finishText(stream, response, text, textStarted, partial));
    let contentIndex = partial.content.length;
    for (const call of response.toolCalls ?? []) {
      stream.push({ type: 'toolcall_start', contentIndex, partial });
      partial = {
        ...partial,
        content: [...partial.content, {
          type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments
        }]
      };
      stream.push({
        type: 'toolcall_end',
        contentIndex,
        toolCall: { type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments },
        partial
      });
      contentIndex += 1;
    }
    const message: AssistantMessage = {
      ...partial,
      responseId: response.providerRequestId,
      usage: toPiUsage(response),
      stopReason: response.toolCalls?.length ? 'toolUse' : response.finishReason === 'length' ? 'length' : 'stop',
      timestamp: Date.now()
    };
    stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'length' | 'toolUse', message });
  } catch (error) {
    options.onError?.(error);
    const aborted = signal?.aborted;
    const message: AssistantMessage = {
      ...partial,
      stopReason: aborted ? 'aborted' : 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now()
    };
    stream.push({ type: 'error', reason: aborted ? 'aborted' : 'error', error: message });
  }
}

function finishText(
  stream: AssistantMessageEventStream,
  response: ProviderResponse,
  streamedText: string,
  textStarted: boolean,
  current: AssistantMessage
) {
  let text = streamedText;
  let partial = current;
  const finalText = typeof response.text === 'string' ? response.text : '';
  if (!textStarted && finalText) {
    textStarted = true;
    stream.push({ type: 'text_start', contentIndex: 0, partial });
    text = finalText;
    partial = withText(partial, text);
    stream.push({ type: 'text_delta', contentIndex: 0, delta: finalText, partial });
  } else if (finalText.startsWith(text) && finalText.length > text.length) {
    const delta = finalText.slice(text.length);
    text = finalText;
    partial = withText(partial, text);
    stream.push({ type: 'text_delta', contentIndex: 0, delta, partial });
  } else if (finalText && finalText !== text) {
    text = finalText;
    partial = withText(partial, text);
  }
  if (textStarted) stream.push({ type: 'text_end', contentIndex: 0, content: text, partial });
  return { text, textStarted, partial };
}

function createAssistantMessage(gateway: ProviderGateway): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'tutor-provider',
    provider: gateway.provider,
    model: gateway.model,
    usage: emptyUsage(),
    stopReason: 'pending',
    timestamp: Date.now()
  };
}

function withText(message: AssistantMessage, text: string): AssistantMessage {
  const remaining = message.content.filter((part) => part.type !== 'text');
  return { ...message, content: text ? [{ type: 'text', text }, ...remaining] : remaining };
}

function toPiUsage(response: ProviderResponse): Usage {
  const input = response.usage.inputTokens ?? 0;
  const output = response.usage.outputTokens ?? 0;
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}
