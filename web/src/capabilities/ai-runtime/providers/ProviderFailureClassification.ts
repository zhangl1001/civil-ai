import {
  ProviderErrorKind,
  ProviderFailureCode
} from '../contracts/ProviderGateway';

/** What a provider told us about a failed call, before any interpretation. */
export interface ProviderFailureSignal {
  readonly status?: number;
  /** Structured error type, e.g. Anthropic `rate_limit_error`, OpenAI `insufficient_quota`. */
  readonly type?: string;
  /** Structured error code, e.g. OpenAI `model_not_found`. */
  readonly code?: string;
  readonly message: string;
  readonly html?: boolean;
}

export interface ProviderFailureClass {
  readonly kind: ProviderErrorKind;
  readonly code?: ProviderFailureCode;
}

/**
 * Classifies by HTTP status and the provider's structured error type/code
 * first. Message text is consulted only where one status covers distinct
 * causes: quota exhaustion vs. throughput limits on 429, and context overflow
 * or a wrong model name among generic 400s.
 */
export function classifyProviderFailure(
  signal: ProviderFailureSignal,
  unknownKind: ProviderErrorKind = ProviderErrorKind.InvalidRequest
): ProviderFailureClass {
  const status = signal.status ?? 0;
  const marker = `${signal.type ?? ''} ${signal.code ?? ''}`.toLowerCase();
  const text = `${marker} ${signal.message}`.toLowerCase();
  if (status === 401 || status === 403 || AUTH_MARKER.test(marker)) {
    return { kind: ProviderErrorKind.Authentication };
  }
  if (status === 402 || QUOTA_MARKER.test(marker) || (status === 429 && QUOTA_TEXT.test(text))) {
    return { kind: ProviderErrorKind.QuotaExceeded };
  }
  if (status === 429 || RATE_MARKER.test(marker)) return { kind: ProviderErrorKind.RateLimited };
  if (status === 529 || OVERLOADED_MARKER.test(marker)) {
    return { kind: ProviderErrorKind.Transient, code: ProviderFailureCode.Overloaded };
  }
  if (status === 408 || status >= 500 || SERVER_MARKER.test(marker)) {
    return { kind: ProviderErrorKind.Transient };
  }
  if (status === 404 || NOT_FOUND_MARKER.test(marker)) {
    return {
      kind: ProviderErrorKind.InvalidRequest,
      code: !signal.html && /model/.test(text)
        ? ProviderFailureCode.ModelNotFound
        : ProviderFailureCode.EndpointNotFound
    };
  }
  if (status === 413 || CONTEXT_MARKER.test(marker) || CONTEXT_TEXT.test(text)) {
    return { kind: ProviderErrorKind.InvalidRequest, code: ProviderFailureCode.ContextTooLong };
  }
  if (MODEL_TEXT.test(text)) {
    return { kind: ProviderErrorKind.InvalidRequest, code: ProviderFailureCode.ModelNotFound };
  }
  if (MEDIA_TEXT.test(text)) {
    return { kind: ProviderErrorKind.InvalidRequest, code: ProviderFailureCode.UnsupportedMedia };
  }
  return { kind: status ? ProviderErrorKind.InvalidRequest : unknownKind };
}

/** Reads the error envelope shapes used by Anthropic, OpenAI and compatible gateways. */
export function providerErrorEnvelope(payload: unknown): Omit<ProviderFailureSignal, 'status' | 'html'> {
  const root = asRecord(payload);
  const error = asRecord(root?.error);
  const source = error ?? root;
  return {
    type: optionalText(source?.type) ?? optionalText(root?.type),
    code: optionalText(source?.code),
    message: optionalText(source?.message) ?? optionalText(root?.message) ?? ''
  };
}

const AUTH_MARKER = /authentication|permission|invalid_api_key|invalid_x_api_key|unauthori[sz]ed/;
const QUOTA_MARKER = /insufficient_quota|insufficient_balance|quota_exceeded|billing|payment_required/;
const QUOTA_TEXT = /quota|insufficient|balance|billing|credit|余额|额度|欠费/;
const RATE_MARKER = /rate_limit/;
const OVERLOADED_MARKER = /overloaded/;
const SERVER_MARKER = /api_error|server_error|internal_error|service_unavailable/;
const NOT_FOUND_MARKER = /not_found/;
const CONTEXT_MARKER = /context_length|context_window|prompt_too_long|token_limit/;
const CONTEXT_TEXT = /maximum context|context (?:length|window)|too many tokens|prompt is too long|input is too long|上下文.{0,8}(?:过长|超出|超过|上限)/;
const MODEL_TEXT = /model\b.{0,60}(?:not exist|not found|does not exist|不存在)|(?:unknown|invalid|unsupported) model\b|no such model|模型不存在/;
const MEDIA_TEXT = /image|vision|multimodal|media_type|图片|图像/;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
