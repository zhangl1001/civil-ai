import { requirePublicWebUrl } from '../domain/WebUrlPolicy';

export async function requireWebResponse(response: Response, operation: string): Promise<string> {
  const text = await response.text();
  if (response.ok) return text;
  let message = text.slice(0, 300);
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    message = String(body.readableMessage || body.message || body.error || body.detail || message);
  } catch {
    // Keep the bounded response body as the diagnostic.
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${operation}密钥无效或无权限：${message}`);
  }
  if (response.status === 429) throw new Error(`${operation}请求过于频繁，请稍后重试。`);
  throw new Error(`${operation}失败（${response.status}）：${message}`);
}

export function compactWebFailures(...failures: unknown[]): string {
  const messages = failures
    .map((error) => error instanceof Error ? error.message : '')
    .filter(Boolean)
    .map((message) => message.replace(/AI 网络请求失败：/g, '').slice(0, 140));
  return [...new Set(messages)].join('；') || '当前网络没有返回有效结果，请稍后重试。';
}

export function webResearchProxyOrigin(): string | undefined {
  return import.meta.env.DEV && typeof window !== 'undefined' ? window.location.origin : undefined;
}

export function publicResponseUrl(response: Response, fallback: URL): URL {
  const values = [
    response.headers.get('x-web-research-final-url'),
    response.headers.get('x-platform-final-url'),
    response.url
  ];
  for (const value of values) {
    try {
      if (value) return requirePublicWebUrl(value);
    } catch {
      // Development proxy metadata may not be a public URL.
    }
  }
  return fallback;
}

export async function runBoundedWebResearchAttempt<T>(
  parent: AbortSignal | undefined,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new RangeError('Web research timeout must be positive');
  }
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(
    parent?.reason ?? new DOMException('Request aborted', 'AbortError')
  );
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener('abort', abortFromParent, { once: true });
  const timer = globalThis.setTimeout(() => controller.abort(new Error('搜索源响应超时')), timeoutMs);
  let rejectOnAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = () => reject(
      controller.signal.reason ?? new DOMException('Request aborted', 'AbortError')
    );
    controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
  });
  try {
    controller.signal.throwIfAborted();
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    globalThis.clearTimeout(timer);
    if (rejectOnAbort) controller.signal.removeEventListener('abort', rejectOnAbort);
    parent?.removeEventListener('abort', abortFromParent);
  }
}
