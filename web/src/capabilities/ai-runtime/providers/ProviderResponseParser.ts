import type { ModelToolCall, ProviderResponse } from '../contracts/ProviderGateway';
import type { JsonObject } from '@/kernel/public';

export function parseOpenAIResponse(input: unknown): ProviderResponse {
  const root = asRecord(input, 'OpenAI response');
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choice = choices[0] ? asRecord(choices[0], 'OpenAI response choice') : undefined;
  const message = choice?.message ? asRecord(choice.message, 'OpenAI response message') : undefined;
  const toolCalls = readOpenAIToolCalls(message?.tool_calls);
  const structuredCall = toolCalls.find((call) => call.name === 'submit_structured_result');
  const text = structuredCall
    ? JSON.stringify(structuredCall.arguments)
    : readTextContent(message?.content) || readOptionalString(root.output_text) || readOptionalString(choice?.text);
  const usage = root.usage ? asRecord(root.usage, 'OpenAI response usage') : undefined;
  return {
    text,
    toolCalls: toolCalls.filter((call) => call.name !== 'submit_structured_result'),
    finishReason: readOptionalString(choice?.finish_reason),
    providerRequestId: readOptionalString(root.id),
    usage: {
      inputTokens: readOptionalNumber(usage?.prompt_tokens ?? usage?.input_tokens),
      outputTokens: readOptionalNumber(usage?.completion_tokens ?? usage?.output_tokens)
    }
  };
}

function readOpenAIToolCalls(input: unknown): ModelToolCall[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    if (candidate.type !== 'function' || !candidate.function) return [];
    const fn = asRecord(candidate.function, 'OpenAI function tool call');
    const name = readOptionalString(fn.name);
    if (!name) return [];
    return [{
      id: readOptionalString(candidate.id) || `openai-tool-${index}`,
      name,
      arguments: parseToolArguments(fn.arguments)
    }];
  });
}

export function parseAnthropicResponse(input: unknown): ProviderResponse {
  const root = asRecord(input, 'Anthropic response');
  const usage = root.usage ? asRecord(root.usage, 'Anthropic response usage') : undefined;
  const toolCalls = readAnthropicToolCalls(root.content);
  const structuredInput = toolCalls.find((call) => call.name === 'submit_structured_result')?.arguments;
  return {
    text: structuredInput === undefined ? readTextContent(root.content) : JSON.stringify(structuredInput),
    toolCalls: toolCalls.filter((call) => call.name !== 'submit_structured_result'),
    finishReason: readOptionalString(root.stop_reason),
    providerRequestId: readOptionalString(root.id),
    usage: {
      inputTokens: readOptionalNumber(usage?.input_tokens),
      outputTokens: readOptionalNumber(usage?.output_tokens)
    }
  };
}

function readAnthropicToolCalls(input: unknown): ModelToolCall[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    if (candidate.type !== 'tool_use') return [];
    const name = readOptionalString(candidate.name);
    if (!name) return [];
    return [{
      id: readOptionalString(candidate.id) || `anthropic-tool-${index}`,
      name,
      arguments: parseToolArguments(candidate.input)
    }];
  });
}

export function openAITextDelta(input: unknown): string {
  const root = asRecord(input, 'OpenAI stream event');
  const choices = Array.isArray(root.choices) ? root.choices : [];
  if (!choices[0]) return '';
  const choice = asRecord(choices[0], 'OpenAI stream choice');
  const delta = choice.delta ? asRecord(choice.delta, 'OpenAI stream delta') : undefined;
  return readTextContent(delta?.content);
}

export function anthropicTextDelta(input: unknown): string {
  const root = asRecord(input, 'Anthropic stream event');
  if (root.type !== 'content_block_delta') return '';
  const delta = root.delta ? asRecord(root.delta, 'Anthropic stream delta') : undefined;
  return delta?.type === 'text_delta' ? readOptionalString(delta.text) : '';
}

interface StreamToolCallBuffer {
  id: string;
  name: string;
  arguments: string;
}

export class OpenAIStreamAccumulator {
  private text = '';
  private finishReason?: string;
  private providerRequestId?: string;
  private inputTokens?: number;
  private outputTokens?: number;
  private readonly toolCalls = new Map<number, StreamToolCallBuffer>();

  append(input: unknown): string {
    const root = asRecord(input, 'OpenAI stream event');
    this.providerRequestId ||= readOptionalString(root.id) || undefined;
    const usage = root.usage ? asRecord(root.usage, 'OpenAI stream usage') : undefined;
    this.inputTokens = readOptionalNumber(usage?.prompt_tokens ?? usage?.input_tokens) ?? this.inputTokens;
    this.outputTokens = readOptionalNumber(usage?.completion_tokens ?? usage?.output_tokens) ?? this.outputTokens;
    const choices = Array.isArray(root.choices) ? root.choices : [];
    if (!choices[0]) return '';
    const choice = asRecord(choices[0], 'OpenAI stream choice');
    this.finishReason = readOptionalString(choice.finish_reason) || this.finishReason;
    const delta = choice.delta ? asRecord(choice.delta, 'OpenAI stream delta') : undefined;
    const text = readTextContent(delta?.content);
    this.text += text;
    this.appendToolCalls(delta?.tool_calls);
    return text;
  }

  response(): ProviderResponse {
    return {
      text: this.text,
      toolCalls: Array.from(this.toolCalls.entries())
        .sort(([left], [right]) => left - right)
        .flatMap(([, call]) => call.name ? [{
          id: call.id,
          name: call.name,
          arguments: parseToolArguments(call.arguments)
        }] : []),
      finishReason: this.finishReason,
      providerRequestId: this.providerRequestId,
      usage: {
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens
      }
    };
  }

  private appendToolCalls(input: unknown): void {
    if (!Array.isArray(input)) return;
    input.forEach((item, fallbackIndex) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      const raw = item as Record<string, unknown>;
      const index = typeof raw.index === 'number' ? raw.index : fallbackIndex;
      const current = this.toolCalls.get(index) ?? {
        id: readOptionalString(raw.id) || `openai-stream-tool-${index}`,
        name: '',
        arguments: ''
      };
      const fn = raw.function && typeof raw.function === 'object' && !Array.isArray(raw.function)
        ? raw.function as Record<string, unknown>
        : undefined;
      this.toolCalls.set(index, {
        id: readOptionalString(raw.id) || current.id,
        name: current.name + readOptionalString(fn?.name),
        arguments: current.arguments + readOptionalString(fn?.arguments)
      });
    });
  }
}

export class AnthropicStreamAccumulator {
  private text = '';
  private finishReason?: string;
  private providerRequestId?: string;
  private inputTokens?: number;
  private outputTokens?: number;
  private readonly toolCalls = new Map<number, StreamToolCallBuffer>();

  append(input: unknown): string {
    const root = asRecord(input, 'Anthropic stream event');
    this.captureMessageMetadata(root);
    const index = typeof root.index === 'number' ? root.index : 0;
    if (root.type === 'content_block_start') {
      const block = root.content_block ? asRecord(root.content_block, 'Anthropic content block') : undefined;
      if (block?.type === 'tool_use') {
        this.toolCalls.set(index, {
          id: readOptionalString(block.id) || `anthropic-stream-tool-${index}`,
          name: readOptionalString(block.name),
          arguments: ''
        });
      }
      return '';
    }
    if (root.type !== 'content_block_delta') return '';
    const delta = root.delta ? asRecord(root.delta, 'Anthropic stream delta') : undefined;
    if (delta?.type === 'text_delta') {
      const text = readOptionalString(delta.text);
      this.text += text;
      return text;
    }
    if (delta?.type === 'input_json_delta') {
      const current = this.toolCalls.get(index) ?? {
        id: `anthropic-stream-tool-${index}`,
        name: '',
        arguments: ''
      };
      this.toolCalls.set(index, {
        ...current,
        arguments: current.arguments + readOptionalString(delta.partial_json)
      });
    }
    return '';
  }

  response(): ProviderResponse {
    return {
      text: this.text,
      toolCalls: Array.from(this.toolCalls.entries())
        .sort(([left], [right]) => left - right)
        .flatMap(([, call]) => call.name ? [{
          id: call.id,
          name: call.name,
          arguments: parseToolArguments(call.arguments)
        }] : []),
      finishReason: this.finishReason,
      providerRequestId: this.providerRequestId,
      usage: {
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens
      }
    };
  }

  private captureMessageMetadata(root: Record<string, unknown>): void {
    if (root.type === 'message_start' && root.message) {
      const message = asRecord(root.message, 'Anthropic stream message');
      this.providerRequestId ||= readOptionalString(message.id) || undefined;
      const usage = message.usage ? asRecord(message.usage, 'Anthropic stream usage') : undefined;
      this.inputTokens = readOptionalNumber(usage?.input_tokens) ?? this.inputTokens;
      this.outputTokens = readOptionalNumber(usage?.output_tokens) ?? this.outputTokens;
    }
    if (root.type === 'message_delta') {
      const delta = root.delta ? asRecord(root.delta, 'Anthropic stream message delta') : undefined;
      this.finishReason = readOptionalString(delta?.stop_reason) || this.finishReason;
      const usage = root.usage ? asRecord(root.usage, 'Anthropic stream usage') : undefined;
      this.outputTokens = readOptionalNumber(usage?.output_tokens) ?? this.outputTokens;
    }
  }
}

function readTextContent(input: unknown): string {
  if (typeof input === 'string') return input;
  if (!Array.isArray(input)) return '';
  return input.map((item) => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
    return readOptionalString((item as Record<string, unknown>).text);
  }).join('');
}

function asRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`${label} must be an object`);
  return input as Record<string, unknown>;
}

function readOptionalString(input: unknown): string {
  return typeof input === 'string' ? input : '';
}

function readOptionalNumber(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : undefined;
}

function parseToolArguments(input: unknown): JsonObject {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return JSON.parse(JSON.stringify(input)) as JsonObject;
  }
  if (typeof input !== 'string' || !input.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(input);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as JsonObject
      : {};
  } catch {
    return { _parseError: 'invalid_tool_arguments', _raw: input.slice(0, 1_000) };
  }
}
