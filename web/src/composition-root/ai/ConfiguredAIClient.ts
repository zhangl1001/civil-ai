import {
  ModelMessageRole,
  type ModelMessage,
  type ProviderResponse
} from '@/capabilities/ai-runtime/public';
import type { JsonObject } from '@/kernel/public';
import { aiConfigService } from '@/services/AIConfigService';
import { createConfiguredProviderGateway } from './createConfiguredProviderGateway';

export interface AITextMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface AITextRequestOptions {
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly responseSchema?: JsonObject;
}

/** Single application entry for chat and non-Agent model calls. */
export class ConfiguredAIClient {
  async complete(
    messages: readonly AITextMessage[],
    signal?: AbortSignal,
    options: AITextRequestOptions = {}
  ): Promise<string> {
    const response = await this.execute(messages, false, undefined, signal, options);
    return response.text;
  }

  async stream(
    messages: readonly AITextMessage[],
    onDelta: (delta: string) => void | Promise<void>,
    signal?: AbortSignal,
    options: AITextRequestOptions = {}
  ): Promise<string> {
    const response = await this.execute(messages, true, onDelta, signal, options);
    return response.text;
  }

  async testConnection(signal?: AbortSignal): Promise<string> {
    return this.complete([
      { role: 'system', content: '你是连接测试助手。只回复“连接正常”。' },
      { role: 'user', content: '请测试当前配置是否可用。' }
    ], signal, { temperature: 0, maxOutputTokens: 64 });
  }

  async testStructuredOutput(signal?: AbortSignal): Promise<void> {
    const result = await this.complete([
      { role: 'system', content: '使用指定结构提交结果。' },
      { role: 'user', content: '提交 ok=true。' }
    ], signal, {
      temperature: 0,
      maxOutputTokens: 128,
      responseSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: { ok: { type: 'boolean', const: true } }
      }
    });
    const parsed = JSON.parse(result) as { ok?: unknown };
    if (parsed.ok !== true) throw new Error('模型未通过结构化输出测试');
  }

  private async execute(
    messages: readonly AITextMessage[],
    preferStream: boolean,
    onDelta: ((delta: string) => void | Promise<void>) | undefined,
    signal: AbortSignal | undefined,
    options: AITextRequestOptions
  ): Promise<ProviderResponse> {
    const config = await aiConfigService.load();
    const gateway = await createConfiguredProviderGateway(config);
    const request = {
      system: messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n'),
      messages: messages
        .filter((message) => message.role !== 'system')
        .map(toModelMessage),
      temperature: options.temperature ?? 0.4,
      maxOutputTokens: options.maxOutputTokens ?? 8_192,
      responseSchema: options.responseSchema,
      requestId: crypto.randomUUID()
    };
    if (
      preferStream
      && config.streamingEnabled !== false
      && !options.responseSchema
      && gateway.stream
      && onDelta
    ) {
      return gateway.stream(request, (event) => onDelta(event.text), signal);
    }
    const response = await gateway.complete(request, signal);
    if (onDelta) await onDelta(response.text);
    return response;
  }
}

function toModelMessage(message: AITextMessage): ModelMessage {
  return {
    role: message.role === 'assistant' ? ModelMessageRole.Assistant : ModelMessageRole.User,
    content: message.content
  };
}

export const configuredAIClient = new ConfiguredAIClient();
