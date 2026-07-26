import {
  ProviderErrorKind,
  ProviderGatewayError,
  type ProviderResponse
} from '../contracts/ProviderGateway';

export async function assertProviderResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
  let message = response.statusText || 'AI provider request failed';
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const root = payload as Record<string, unknown>;
      const error = root.error && typeof root.error === 'object' && !Array.isArray(root.error)
        ? root.error as Record<string, unknown>
        : undefined;
      if (typeof error?.message === 'string') message = error.message;
      else if (typeof root.message === 'string') message = root.message;
    }
  } catch {
    // Status and statusText remain enough for classification.
  }
  const kind = response.status === 401 || response.status === 403
    ? ProviderErrorKind.Authentication
    : response.status === 429
      ? ProviderErrorKind.RateLimited
      : response.status === 408 || response.status >= 500
        ? ProviderErrorKind.Transient
        : ProviderErrorKind.InvalidRequest;
  throw new ProviderGatewayError(message, kind, response.status, retryAfter);
}

export function assertNonEmptyProviderResult(response: ProviderResponse): ProviderResponse {
  if (!response.text.trim() && !response.toolCalls?.length) {
    throw new ProviderGatewayError('AI provider returned empty content', ProviderErrorKind.EmptyResponse);
  }
  return { ...response, text: response.text.trim() };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1, seconds) * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(1000, timestamp - Date.now()) : undefined;
}
