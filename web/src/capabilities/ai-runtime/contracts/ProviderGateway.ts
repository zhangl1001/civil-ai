import type { JsonObject } from '@/kernel/public';

export const ProviderCode = {
  Anthropic: 'anthropic',
  OpenAICompatible: 'openai_compatible'
} as const;

export type ProviderCode = typeof ProviderCode[keyof typeof ProviderCode];

export const ModelMessageRole = {
  User: 'user',
  Assistant: 'assistant'
} as const;

export type ModelMessageRole = typeof ModelMessageRole[keyof typeof ModelMessageRole];

export interface ModelMessage {
  readonly role: ModelMessageRole;
  readonly content: string;
}

export interface ProviderRequest {
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly responseSchema?: JsonObject;
  readonly requestId: string;
}

export interface ProviderUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface ProviderResponse {
  readonly text: string;
  readonly finishReason?: string;
  readonly providerRequestId?: string;
  readonly usage: ProviderUsage;
}

export interface ProviderTextDelta {
  readonly type: 'text_delta';
  readonly text: string;
}

export interface ProviderGateway {
  readonly provider: ProviderCode;
  readonly model: string;
  complete(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse>;
  stream?(
    request: ProviderRequest,
    onEvent: (event: ProviderTextDelta) => void | Promise<void>,
    signal?: AbortSignal
  ): Promise<ProviderResponse>;
}

export const ProviderErrorKind = {
  Authentication: 'authentication',
  RateLimited: 'rate_limited',
  Transient: 'transient',
  InvalidRequest: 'invalid_request',
  EmptyResponse: 'empty_response',
  Protocol: 'protocol'
} as const;

export type ProviderErrorKind = typeof ProviderErrorKind[keyof typeof ProviderErrorKind];

export class ProviderGatewayError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    readonly status?: number,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'ProviderGatewayError';
  }
}
