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

export function assertNonEmptyProviderResult(response: ProviderResponse): ProviderResponse {
  if (!response.text.trim() && !response.toolCalls?.length) {
    throw new ProviderGatewayError('模型没有返回可显示的内容', ProviderErrorKind.EmptyResponse);
  }
  return { ...response, text: response.text.trim() };
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
