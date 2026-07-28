import type { JsonObject } from '@/kernel/public';

export const ProviderCode = {
  Anthropic: 'anthropic',
  OpenAICompatible: 'openai_compatible'
} as const;

export type ProviderCode = typeof ProviderCode[keyof typeof ProviderCode];

export const ModelMessageRole = {
  User: 'user',
  Assistant: 'assistant',
  Tool: 'tool'
} as const;

export type ModelMessageRole = typeof ModelMessageRole[keyof typeof ModelMessageRole];

export interface ModelTextContentPart {
  readonly type: 'text';
  readonly text: string;
}

/**
 * Image data is intentionally an in-memory request part. Agent checkpoints
 * strip this part before persistence so user photos never enter SQLite.
 */
export interface ModelImageContentPart {
  readonly type: 'image';
  readonly mediaType: string;
  readonly dataBase64: string;
  readonly attachmentId?: string;
  readonly name?: string;
}

export type ModelContentPart = ModelTextContentPart | ModelImageContentPart;
export type ModelMessageContent = string | readonly ModelContentPart[];

export interface ModelMessage {
  readonly role: ModelMessageRole;
  readonly content: ModelMessageContent;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ModelToolCall[];
}

export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: JsonObject;
}

export interface ProviderToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
}

export interface ProviderRequest {
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly responseSchema?: JsonObject;
  readonly tools?: readonly ProviderToolDefinition[];
  readonly toolChoice?: 'auto' | 'none' | 'required' | { readonly name: string };
  readonly requestId: string;
}

export interface ProviderUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface ProviderResponse {
  readonly text: string;
  readonly toolCalls?: readonly ModelToolCall[];
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
  /** Protocol capability; a concrete model may still reject unsupported media. */
  readonly capabilities: {
    readonly multimodalInput: boolean;
  };
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
