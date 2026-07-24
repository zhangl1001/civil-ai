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
  send(request: HttpTransportRequest): Promise<Response> {
    return fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal
    });
  }
}
