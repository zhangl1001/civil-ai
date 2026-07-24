import { ProviderCode, type ProviderGateway, type ProviderRequest, type ProviderResponse, type ProviderTextDelta } from '../contracts/ProviderGateway';
import { FetchHttpTransport, type HttpTransport } from '../contracts/HttpTransport';
import { assertNonEmptyProviderResult, assertProviderResponse } from './ProviderHttpSupport';
import { anthropicTextDelta, parseAnthropicResponse } from './ProviderResponseParser';
import { readServerSentEvents } from './SseReader';

export interface AnthropicGatewayConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly anthropicVersion?: string;
}

export class AnthropicGateway implements ProviderGateway {
  readonly provider = ProviderCode.Anthropic;
  readonly model: string;

  constructor(
    private readonly config: AnthropicGatewayConfig,
    private readonly transport: HttpTransport = new FetchHttpTransport()
  ) {
    this.model = config.model;
  }

  async complete(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const response = await this.transport.send(this.httpRequest(request, false, signal));
    await assertProviderResponse(response);
    return assertNonEmptyProviderResult(parseAnthropicResponse(await response.json()));
  }

  async stream(
    request: ProviderRequest,
    onEvent: (event: ProviderTextDelta) => void | Promise<void>,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    const response = await this.transport.send(this.httpRequest(request, true, signal));
    await assertProviderResponse(response);
    if (!response.body) return this.complete(request, signal);
    let text = '';
    await readServerSentEvents(response.body, async (data) => {
      const delta = anthropicTextDelta(JSON.parse(data) as unknown);
      if (!delta) return;
      text += delta;
      await onEvent({ type: 'text_delta', text: delta });
    });
    return assertNonEmptyProviderResult({ text, usage: {} });
  }

  private httpRequest(request: ProviderRequest, stream: boolean, signal?: AbortSignal) {
    return {
      url: `${this.config.baseUrl.replace(/\/$/, '')}/messages`,
      method: 'POST' as const,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': this.config.anthropicVersion ?? '2023-06-01',
        'X-Client-Request-Id': request.requestId
      },
      body: JSON.stringify({
        model: this.config.model,
        system: request.system,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
        stream
      }),
      signal
    };
  }
}
