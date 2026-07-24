import type { AIConfig } from '@/domain/ai';
import { CapacitorHttp } from '@capacitor/core';

export interface AICompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AICompletionRequest {
  messages: AICompletionMessage[];
  temperature?: number;
}

export interface AIProvider {
  complete(request: AICompletionRequest, signal?: AbortSignal): Promise<string>;
  stream?(request: AICompletionRequest, onDelta: (delta: string) => void | Promise<void>, signal?: AbortSignal): Promise<string>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

export class AIRateLimitError extends AIProviderError {
  constructor(message: string, retryAfterMs?: number) {
    super(message, 429, retryAfterMs);
    this.name = 'AIRateLimitError';
  }
}

export class AITransientError extends AIProviderError {
  constructor(message: string, status = 0, retryAfterMs?: number) {
    super(message, status, retryAfterMs);
    this.name = 'AITransientError';
  }
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1, seconds) * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(1000, date - Date.now());
  return undefined;
}

async function providerError(response: Response): Promise<AIProviderError> {
  let message = response.statusText;
  try {
    const data = await response.json();
    message = data?.error?.message || data?.message || response.statusText;
  } catch {
    message = response.statusText;
  }
  if (response.status === 429) return new AIRateLimitError(message || 'AI 服务限流', retryAfterMs(response));
  if (response.status === 408 || response.status >= 500) {
    return new AITransientError(message || 'AI 服务临时异常', response.status, retryAfterMs(response));
  }
  return new AIProviderError(message || 'AI 服务请求失败', response.status, retryAfterMs(response));
}

async function fetchAI(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const message = error instanceof Error ? error.message : 'AI 网络请求失败';
    const isNativeIOS = window.Capacitor?.getPlatform?.() === 'ios' && window.Capacitor?.isNativePlatform?.() !== false;
    const hint = isNativeIOS
      ? '真机请求失败：请确认 Base URL 使用 https、手机网络可访问该服务、API Key 已保存。'
      : 'AI 网络请求失败';
    throw new AITransientError(`${hint}${message ? `（${message}）` : ''}`);
  }
}

function isNativeRuntime(): boolean {
  return window.Capacitor?.isNativePlatform?.() === true;
}

function textFromContentBlocks(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      const block = part as Record<string, unknown>;
      if (typeof block.text === 'string') return block.text;
      if (typeof block.content === 'string') return block.content;
      return '';
    })
    .join('')
    .trim();
}

function textFromOpenAICompatible(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const root = data as Record<string, unknown>;
  if (typeof root.output_text === 'string') return root.output_text.trim();
  if (typeof root.text === 'string') return root.text.trim();
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choice = choices[0] as Record<string, unknown> | undefined;
  if (!choice) return '';
  const message = choice.message as Record<string, unknown> | undefined;
  if (typeof message?.content === 'string') return message.content.trim();
  const blockText = textFromContentBlocks(message?.content);
  if (blockText) return blockText;
  if (typeof choice.text === 'string') return choice.text.trim();
  return '';
}

function responseShape(data: unknown): string {
  if (!data || typeof data !== 'object') return typeof data;
  const root = data as Record<string, unknown>;
  const content = root.content;
  const contentShape = Array.isArray(content)
    ? content.map((part) => part && typeof part === 'object' ? String((part as Record<string, unknown>).type || typeof part) : typeof part).join(',')
    : typeof content;
  return [
    `type=${String(root.type || 'unknown')}`,
    `stop=${String(root.stop_reason || root.finish_reason || 'unknown')}`,
    `content=${contentShape}`,
    `choices=${Array.isArray(root.choices) ? root.choices.length : 0}`
  ].join(' ');
}

export class OpenAICompatibleProvider implements AIProvider {
  constructor(private readonly config: AIConfig) {}

  async complete(request: AICompletionRequest, signal?: AbortSignal): Promise<string> {
    const baseUrl = (this.config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const response = await fetchAI(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.4
      })
    });
    if (!response.ok) throw await providerError(response);
    const data = await response.json();
    return textFromOpenAICompatible(data);
  }

  async stream(
    request: AICompletionRequest,
    onDelta: (delta: string) => void | Promise<void>,
    signal?: AbortSignal
  ): Promise<string> {
    const baseUrl = (this.config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const response = await fetchAI(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.4,
        stream: true
      })
    });
    if (!response.ok) throw await providerError(response);
    if (!response.body) return this.complete(request, signal);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta?.content || '';
          if (!delta) continue;
          content += delta;
          await onDelta(delta);
        } catch {
          // Ignore malformed SSE keep-alive fragments.
        }
      }
    }

    return content.trim();
  }
}

export class AnthropicProvider implements AIProvider {
  constructor(private readonly config: AIConfig) {}

  private maxTokens(): number {
    const configured = Number((this.config as AIConfig & { max_tokens?: number; maxTokens?: number }).max_tokens || (this.config as AIConfig & { maxTokens?: number }).maxTokens || 0);
    if (Number.isFinite(configured) && configured > 0) return Math.max(1024, Math.min(32768, Math.round(configured)));
    const model = (this.config.model || '').toLowerCase();
    if (model.includes('haiku') || model.includes('mini')) return 4096;
    return 8192;
  }

  private requestBody(request: AICompletionRequest, stream = false): Record<string, unknown> {
    const { system, messages } = this.requestParts(request);
    return {
      model: this.config.model,
      max_tokens: this.maxTokens(),
      system,
      messages,
      stream
    };
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01'
    };
  }

  private parseText(data: unknown): string {
    const direct = textFromContentBlocks((data as { content?: unknown })?.content);
    if (direct) return direct;
    return textFromOpenAICompatible(data);
  }

  private requestParts(request: AICompletionRequest): {
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  } {
    return {
      system: request.messages.find((message) => message.role === 'system')?.content || '',
      messages: request.messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content }))
    };
  }

  async complete(request: AICompletionRequest, signal?: AbortSignal): Promise<string> {
    const url = (this.config.baseUrl || 'https://api.anthropic.com/v1').replace(/\/$/, '') + '/messages';
    const body = this.requestBody(request, false);

    if (isNativeRuntime()) {
      try {
        const response = await CapacitorHttp.request({
          url,
          method: 'POST',
          headers: this.headers(),
          data: body,
          connectTimeout: 30000,
          readTimeout: 180000
        });
        if (response.status >= 200 && response.status < 300) {
          const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
          const content = this.parseText(data);
          if (!content) throw new AIProviderError(`Anthropic 返回为空（${responseShape(data)}）`, 200);
          return content;
        }
        throw new AIProviderError(`HTTP ${response.status}: ${JSON.stringify(response.data).slice(0, 240)}`, response.status);
      } catch (error) {
        if (error instanceof AIProviderError) throw error;
        // Fall back to fetch below; some web/debug runtimes do not expose native HTTP.
      }
    }

    const response = await fetchAI(url, {
      method: 'POST',
      signal,
      headers: this.headers(),
      body: JSON.stringify(body)
    });
    if (!response.ok) throw await providerError(response);
    const data = await response.json();
    const content = this.parseText(data);
    if (!content) throw new AIProviderError(`Anthropic 返回为空（${responseShape(data)}）`, 200);
    return content;
  }

  async stream(
    request: AICompletionRequest,
    onDelta: (delta: string) => void | Promise<void>,
    signal?: AbortSignal
  ): Promise<string> {
    const response = await fetchAI((this.config.baseUrl || 'https://api.anthropic.com/v1').replace(/\/$/, '') + '/messages', {
      method: 'POST',
      signal,
      headers: this.headers(),
      body: JSON.stringify(this.requestBody(request, true))
    });
    if (!response.ok) throw await providerError(response);
    if (!response.body) return this.complete(request, signal);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const event = JSON.parse(payload);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const delta = event.delta.text || '';
            if (!delta) continue;
            content += delta;
            await onDelta(delta);
          }
        } catch {
          // Ignore malformed SSE keep-alive fragments.
        }
      }
    }

    return content.trim();
  }
}
