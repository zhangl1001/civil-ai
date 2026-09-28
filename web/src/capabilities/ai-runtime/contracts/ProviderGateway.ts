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

/**
 * Provider reasoning attached to an assistant turn. Anthropic requires the
 * thinking blocks of a tool_use turn to be replayed unchanged (signature
 * included) when its tool results are sent back. Never shown to users.
 */
export interface ModelReasoningBlock {
  readonly type: 'thinking' | 'redacted_thinking';
  /** Thinking text of a `thinking` block; may be empty. */
  readonly thinking?: string;
  readonly signature?: string;
  /** Opaque payload of a `redacted_thinking` block. */
  readonly data?: string;
}

export interface ModelMessage {
  readonly role: ModelMessageRole;
  readonly content: ModelMessageContent;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ModelToolCall[];
  /** Assistant reasoning to replay verbatim before this turn's tool calls. */
  readonly reasoning?: readonly ModelReasoningBlock[];
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
  /**
   * Content pipelines can prefer schema-in-prompt JSON so parallel shards do
   * not serialize behind a full-response capability probe. Agent tool calls
   * remain independent and continue to use the provider tool protocol.
   */
  readonly structuredOutputMode?: 'auto' | 'prompt';
  readonly tools?: readonly ProviderToolDefinition[];
  readonly toolChoice?: 'auto' | 'none' | 'required' | { readonly name: string };
  /**
   * Asks endpoints that think by default to answer directly, e.g. for a
   * connection test whose tiny budget would otherwise be spent on reasoning.
   */
  readonly thinking?: 'disabled';
  readonly requestId: string;
}

export interface ProviderUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface ProviderResponse {
  readonly text: string;
  readonly toolCalls?: readonly ModelToolCall[];
  /** Reasoning blocks in provider order, for replay on the next tool turn. */
  readonly reasoning?: readonly ModelReasoningBlock[];
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
  /**
   * Resolves the endpoint/model structured-output mode with a tiny probe.
   * Large parallel content requests can then start together instead of using
   * the first full generation response as a capability probe.
   */
  prepareStructuredOutput?(signal?: AbortSignal): Promise<void>;
  stream?(
    request: ProviderRequest,
    onEvent: (event: ProviderTextDelta) => void | Promise<void>,
    signal?: AbortSignal
  ): Promise<ProviderResponse>;
}

export const ProviderErrorKind = {
  Authentication: 'authentication',
  RateLimited: 'rate_limited',
  /** Balance or quota is exhausted. Waiting does not help, so nothing retries it. */
  QuotaExceeded: 'quota_exceeded',
  Transient: 'transient',
  InvalidRequest: 'invalid_request',
  EmptyResponse: 'empty_response',
  /**
   * No answer text: the output limit was hit, or the whole output went into
   * reasoning. The same request would end the same way, so it is not retried.
   */
  OutputLimit: 'output_limit',
  Protocol: 'protocol'
} as const;

export type ProviderErrorKind = typeof ProviderErrorKind[keyof typeof ProviderErrorKind];

/**
 * Stable failure identity below the recovery class: `kind` decides whether a
 * call may be retried, `code` says what actually went wrong so callers can
 * explain it without parsing provider prose.
 */
export const ProviderFailureCode = {
  ModelNotFound: 'provider.model_not_found',
  EndpointNotFound: 'provider.endpoint_not_found',
  ContextTooLong: 'provider.context_too_long',
  UnsupportedMedia: 'provider.unsupported_media',
  HtmlResponse: 'provider.html_response',
  ThinkingOnly: 'provider.thinking_only',
  StreamInterrupted: 'provider.stream_interrupted',
  Overloaded: 'provider.overloaded',
  Timeout: 'provider.timeout',
  NetworkUnavailable: 'network.unavailable'
} as const;

export type ProviderFailureCode = typeof ProviderFailureCode[keyof typeof ProviderFailureCode];

export class ProviderGatewayError extends Error {
  /** `provider.<kind>` unless a finer {@link ProviderFailureCode} is known. */
  readonly code: string;

  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    readonly status?: number,
    readonly retryAfterMs?: number,
    code?: ProviderFailureCode
  ) {
    super(message);
    this.name = 'ProviderGatewayError';
    this.code = code ?? `provider.${kind}`;
  }
}
