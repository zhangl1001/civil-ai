import {
  ProviderErrorKind,
  ProviderFailureCode,
  ProviderGatewayError,
  type ProviderResponse
} from '../contracts/ProviderGateway';
import { classifyProviderFailure, providerErrorEnvelope } from './ProviderFailureClassification';

export async function assertProviderResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
  const raw = await response.text().catch(() => '');
  const html = isHtmlResponse(response, raw);
  const envelope = html ? { message: '' } : parseErrorEnvelope(raw);
  const failure = classifyProviderFailure({ ...envelope, status: response.status, html });
  throw new ProviderGatewayError(
    envelope.message || response.statusText || `AI 服务请求失败（HTTP ${response.status}）`,
    failure.kind,
    response.status,
    retryAfter,
    failure.code
  );
}

/** A 2xx body that could not be read as a model response. */
export function unreadableProviderResponse(response: Response, provider: string): ProviderGatewayError {
  return isHtmlResponse(response)
    ? new ProviderGatewayError(
        `${provider}接口返回了网页而不是模型响应，请检查接口地址（Base URL）`,
        ProviderErrorKind.Protocol,
        response.status,
        undefined,
        ProviderFailureCode.HtmlResponse
      )
    : new ProviderGatewayError(`${provider}接口返回的响应格式无法识别`, ProviderErrorKind.Protocol, response.status);
}

export function isHtmlResponse(response: Response, body = ''): boolean {
  return /text\/html/i.test(response.headers.get('content-type') ?? '')
    || /^\s*<(?:!doctype\s+html|html)[\s>]/i.test(body);
}

/** Anthropic `max_tokens`, OpenAI `length` and their compatible spellings. */
export function isOutputLengthFinish(finishReason: string | undefined): boolean {
  return finishReason === 'max_tokens'
    || finishReason === 'length'
    || finishReason === 'max_output_tokens'
    || finishReason === 'model_length';
}

export function assertNonEmptyProviderResult(
  response: ProviderResponse,
  sawReasoning = false
): ProviderResponse {
  if (!response.text.trim() && !response.toolCalls?.length) {
    if (sawReasoning) {
      throw new ProviderGatewayError(
        isOutputLengthFinish(response.finishReason)
          ? '模型把输出额度都用在了思考过程上，已达长度上限，没有给出正文'
          : '模型只输出了思考过程，没有给出正文',
        ProviderErrorKind.OutputLimit,
        undefined,
        undefined,
        ProviderFailureCode.ThinkingOnly
      );
    }
    if (isOutputLengthFinish(response.finishReason)) {
      throw new ProviderGatewayError('模型输出已达长度上限，但没有给出正文', ProviderErrorKind.OutputLimit);
    }
    throw new ProviderGatewayError('模型没有返回可显示的内容', ProviderErrorKind.EmptyResponse);
  }
  return { ...response, text: response.text.trim() };
}

/** A stream body ended without the provider's completion marker. */
export function interruptedProviderStream(detail?: string): ProviderGatewayError {
  return new ProviderGatewayError(
    detail ? `模型回复在传输中途中断：${detail}` : '模型回复在传输中途中断，没有收到结束标记',
    ProviderErrorKind.Transient,
    undefined,
    undefined,
    ProviderFailureCode.StreamInterrupted
  );
}

/** Malformed SSE payloads are protocol errors; anything else broke the connection. */
export function isStreamPayloadError(error: unknown): boolean {
  return error instanceof SyntaxError
    || (error instanceof TypeError && /must be an object/.test(error.message));
}

function parseErrorEnvelope(raw: string): ReturnType<typeof providerErrorEnvelope> {
  try {
    return providerErrorEnvelope(JSON.parse(raw) as unknown);
  } catch {
    return { message: raw.trim().slice(0, 300) };
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1, seconds) * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(1000, timestamp - Date.now()) : undefined;
}
