import { Capacitor, CapacitorHttp } from '@capacitor/core';
import {
  ProviderErrorKind,
  ProviderGatewayError,
  type HttpTransport,
  type HttpTransportRequest
} from '@/capabilities/ai-runtime/public';
import {
  isNativeStreamingPluginUnavailable,
  NativeStreamingHttpAdapter
} from '@/platform/NativeStreamingHttpAdapter';

let warnedAboutNativeTransportFallback = false;

/** Uses native HTTP on iOS so every AI request has the same CORS-free transport. */
export class PlatformHttpTransport implements HttpTransport {
  private readonly streaming = new NativeStreamingHttpAdapter();

  async send(request: HttpTransportRequest): Promise<Response> {
    request.signal?.throwIfAborted();
    if (!Capacitor.isNativePlatform()) return this.sendWithFetch(request);
    if (request.method === 'POST' && request.body !== undefined) {
      try {
        return await this.streaming.send(request);
      } catch (error) {
        if (request.signal?.aborted) throw request.signal.reason;
        if (!isNativeStreamingPluginUnavailable(error)) throw networkError(error);
        if (!warnedAboutNativeTransportFallback) {
          warnedAboutNativeTransportFallback = true;
          console.warn(
            '[AITransport] NativeStreamingHTTP registration probe failed; AI requests use the CapacitorHttp fallback for this app process.',
            error
          );
        }
      }
    }

    return this.sendWithCapacitorHttp(request);
  }

  private async sendWithCapacitorHttp(request: HttpTransportRequest): Promise<Response> {
    try {
      const requestOptions = {
          url: request.url,
          method: request.method,
          headers: { ...request.headers },
          connectTimeout: 30_000,
          readTimeout: 300_000,
          ...(request.body === undefined ? {} : { data: parseRequestBody(request.body) })
        };
      const response = await settleWithAbort(
        CapacitorHttp.request(requestOptions),
        request.signal
      );
      request.signal?.throwIfAborted();
      const headers = normalizeHeaders(response.headers);
      if (response.url) headers.set('x-platform-final-url', response.url);
      return new Response(serializeBody(response.data), {
        status: response.status,
        headers
      });
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason;
      if (error instanceof ProviderGatewayError) throw error;
      throw networkError(error);
    }
  }

  private async sendWithFetch(request: HttpTransportRequest): Promise<Response> {
    try {
      return await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: request.signal
      });
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason;
      throw networkError(error);
    }
  }
}

function parseRequestBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function serializeBody(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? {});
}

function normalizeHeaders(input: Record<string, string>): Headers {
  const headers = new Headers();
  Object.entries(input || {}).forEach(([key, value]) => headers.set(key, String(value)));
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return headers;
}

function networkError(error: unknown): ProviderGatewayError {
  const message = error instanceof Error ? error.message : String(error || 'network request failed');
  return new ProviderGatewayError(
    `AI 网络请求失败：${message}`,
    ProviderErrorKind.Transient
  );
}

/** CapacitorHttp cannot cancel an in-flight native request, so detach the caller immediately on abort. */
export async function settleWithAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'));
    };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}
