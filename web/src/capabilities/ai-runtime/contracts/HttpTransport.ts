import { ProviderErrorKind, ProviderGatewayError } from './ProviderGateway';

export interface HttpTransportRequest {
  readonly url: string;
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal?: AbortSignal;
}

export interface HttpTransport {
  send(request: HttpTransportRequest): Promise<Response>;
}

export class FetchHttpTransport implements HttpTransport {
  async send(request: HttpTransportRequest): Promise<Response> {
    try {
      return await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: request.signal
      });
    } catch (error) {
      if (request.signal?.aborted) {
        throw request.signal.reason ?? error;
      }
      if (error instanceof ProviderGatewayError) throw error;
      const message = error instanceof Error ? error.message : String(error || 'network request failed');
      throw new ProviderGatewayError(`AI 网络请求失败：${message}`, ProviderErrorKind.Transient);
    }
  }
}
