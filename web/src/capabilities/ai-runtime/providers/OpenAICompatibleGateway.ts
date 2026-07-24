import { ProviderCode, type ProviderGateway, type ProviderRequest, type ProviderResponse, type ProviderTextDelta } from '../contracts/ProviderGateway';
import { FetchHttpTransport, type HttpTransport } from '../contracts/HttpTransport';
import { assertNonEmptyProviderResult, assertProviderResponse } from './ProviderHttpSupport';
import { openAITextDelta, parseOpenAIResponse } from './ProviderResponseParser';
import { readServerSentEvents } from './SseReader';

export interface OpenAICompatibleGatewayConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly supportsJsonSchema: boolean;
}

export class OpenAICompatibleGateway implements ProviderGateway {
  readonly provider = ProviderCode.OpenAICompatible;
  readonly model: string;

  constructor(
    private readonly config: OpenAICompatibleGatewayConfig,
    private readonly transport: HttpTransport = new FetchHttpTransport()
  ) {
    this.model = config.model;
  }

  async complete(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const response = await this.transport.send(this.httpRequest(request, false, signal));
    await assertProviderResponse(response);
    return assertNonEmptyProviderResult(parseOpenAIResponse(await response.json()));
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
      if (data === '[DONE]') return;
      const delta = openAITextDelta(JSON.parse(data) as unknown);
      if (!delta) return;
      text += delta;
      await onEvent({ type: 'text_delta', text: delta });
    });
    return assertNonEmptyProviderResult({ text, usage: {} });
  }

  private httpRequest(request: ProviderRequest, stream: boolean, signal?: AbortSignal) {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [
        { role: 'system', content: request.system },
        ...request.messages
      ],
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      stream
    };
    if (request.responseSchema && this.config.supportsJsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'structured_result', strict: true, schema: request.responseSchema }
      };
    }
    return {
      url: `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`,
      method: 'POST' as const,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        'X-Client-Request-Id': request.requestId
      },
      body: JSON.stringify(body),
      signal
    };
  }
}
