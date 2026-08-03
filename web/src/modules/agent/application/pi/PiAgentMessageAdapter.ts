import {
  ModelMessageRole,
  type ModelMessage,
  type ModelMessageContent,
  type ModelToolCall
} from '@/capabilities/ai-runtime/public';
import type {
  AgentMessage as PiAgentMessage
} from '@earendil-works/pi-agent-core';
import type {
  AssistantMessage as PiAssistantMessage,
  Message as PiMessage
} from '@earendil-works/pi-ai';

export function toPiMessages(messages: readonly ModelMessage[]): PiAgentMessage[] {
  const toolNames = toolNamesByCallId(messages);
  return messages.map((message) => {
    if (message.role === ModelMessageRole.User) {
      return {
        role: 'user',
        content: toPiContent(message.content),
        timestamp: Date.now()
      };
    }
    if (message.role === ModelMessageRole.Tool) {
      return {
        role: 'toolResult',
        toolCallId: message.toolCallId || 'unknown',
        toolName: toolNames.get(message.toolCallId || '') || 'unknown',
        content: [{ type: 'text', text: contentText(message.content) }],
        isError: false,
        timestamp: Date.now()
      };
    }
    return {
      role: 'assistant',
      content: [
        ...(contentText(message.content)
          ? [{ type: 'text' as const, text: contentText(message.content) }]
          : []),
        ...(message.toolCalls ?? []).map((call) => ({
          type: 'toolCall' as const,
          id: call.id,
          name: call.name,
          arguments: call.arguments
        }))
      ],
      api: 'tutor-provider',
      provider: 'tutor-provider',
      model: 'tutor-provider',
      usage: emptyUsage(),
      stopReason: message.toolCalls?.length ? 'toolUse' : 'stop',
      timestamp: Date.now()
    };
  });
}

export function toModelMessages(
  messages: readonly PiAgentMessage[],
  options: { readonly omitToolResultId?: string } = {}
): ModelMessage[] {
  const result: ModelMessage[] = [];
  messages.forEach((message) => {
    if (!isPiMessage(message)) return;
    if (message.role === 'user') {
      result.push({ role: ModelMessageRole.User, content: fromPiContent(message.content) });
      return;
    }
    if (message.role === 'toolResult') {
      if (message.toolCallId === options.omitToolResultId) return;
      result.push({
        role: ModelMessageRole.Tool,
        toolCallId: message.toolCallId,
        content: message.content.map((part) => part.type === 'text' ? part.text : '').filter(Boolean).join('\n')
      });
      return;
    }
    result.push({
      role: ModelMessageRole.Assistant,
      content: assistantText(message),
      toolCalls: assistantToolCalls(message)
    });
  });
  return result;
}

export function toProviderMessages(messages: readonly PiMessage[]): ModelMessage[] {
  return toModelMessages(messages);
}

export function assistantText(message: PiAssistantMessage): string {
  return message.content
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function assistantToolCalls(message: PiAssistantMessage): ModelToolCall[] {
  return message.content
    .filter((part): part is Extract<typeof part, { type: 'toolCall' }> => part.type === 'toolCall')
    .map((part) => ({ id: part.id, name: part.name, arguments: part.arguments }));
}

function isPiMessage(message: PiAgentMessage): message is PiMessage {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult';
}

function toPiContent(content: ModelMessageContent) {
  if (typeof content === 'string') return content;
  return content.map((part) => part.type === 'text'
    ? { type: 'text' as const, text: part.text }
    : { type: 'image' as const, data: part.dataBase64, mimeType: part.mediaType });
}

function fromPiContent(content: Extract<PiMessage, { role: 'user' }>['content']): ModelMessageContent {
  if (typeof content === 'string') return content;
  return content.map((part) => part.type === 'text'
    ? { type: 'text' as const, text: part.text }
    : { type: 'image' as const, dataBase64: part.data, mediaType: part.mimeType });
}

function contentText(content: ModelMessageContent): string {
  return typeof content === 'string'
    ? content
    : content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

function toolNamesByCallId(messages: readonly ModelMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  messages.forEach((message) => message.toolCalls?.forEach((call) => names.set(call.id, call.name)));
  return names;
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}
