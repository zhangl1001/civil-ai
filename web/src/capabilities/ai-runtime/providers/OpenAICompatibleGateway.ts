import {
  ProviderCode,
  ProviderErrorKind,
  ProviderGatewayError,
  type ProviderGateway,
  type ProviderRequest,
  type ProviderResponse,
  type ProviderTextDelta
} from '../contracts/ProviderGateway';
import { FetchHttpTransport, type HttpTransport } from '../contracts/HttpTransport';
import { assertNonEmptyProviderResult, assertProviderResponse } from './ProviderHttpSupport';
import { OpenAIStreamAccumulator, parseOpenAIResponse } from './ProviderResponseParser';
import { readServerSentEvents } from './SseReader';

export interface OpenAICompatibleGatewayConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
}

const STRUCTURED_RESULT_TOOL = 'submit_structured_result';

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
    try {
      return await this.sendCompletion(request, 'tool', signal);
    } catch (error) {
      if (!request.responseSchema || !isUnsupportedStructuredRequest(error)) throw error;
      return this.sendCompletion(request, 'prompt', signal);
    }
  }

  async stream(
    request: ProviderRequest,
    onEvent: (event: ProviderTextDelta) => void | Promise<void>,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    if (request.responseSchema) {
      const result = await this.complete(request, signal);
      await onEvent({ type: 'text_delta', text: result.text });
      return result;
    }
    const response = await this.transport.send(this.httpRequest(request, true, 'none', signal));
    await assertProviderResponse(response);
    if (!response.body) return this.complete(request, signal);
    const accumulator = new OpenAIStreamAccumulator();
    try {
      await readServerSentEvents(response.body, async (data) => {
        if (data === '[DONE]') return;
        const delta = accumulator.append(JSON.parse(data) as unknown);
        if (!delta) return;
        await onEvent({ type: 'text_delta', text: delta });
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof ProviderGatewayError) throw error;
      throw new ProviderGatewayError('OpenAI-compatible stream protocol is invalid', ProviderErrorKind.Protocol);
    }
    return assertNonEmptyProviderResult(accumulator.response());
  }

  private async sendCompletion(
    request: ProviderRequest,
    structuredMode: 'tool' | 'prompt',
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    const response = await this.transport.send(this.httpRequest(request, false, structuredMode, signal));
    await assertProviderResponse(response);
    return assertNonEmptyProviderResult(parseOpenAIResponse(await response.json()));
  }

  private httpRequest(
    request: ProviderRequest,
    stream: boolean,
    structuredMode: 'none' | 'tool' | 'prompt',
    signal?: AbortSignal
  ) {
    if (request.responseSchema && request.tools?.length) {
      throw new Error('Structured response schema and Agent tools cannot be requested together');
    }
    const system = structuredMode === 'prompt' && request.responseSchema
      ? structuredJsonInstruction(request.system, request.responseSchema)
      : request.system;
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [
        { role: 'system', content: system },
        ...request.messages.map(toOpenAIMessage)
      ],
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      stream
    };
    if (request.responseSchema && structuredMode === 'tool') {
      body.tools = [{
        type: 'function',
        function: {
          name: STRUCTURED_RESULT_TOOL,
          description: '提交最终结构化结果。参数必须完整符合给定 JSON Schema，不要把结果放在普通文本中。',
          parameters: request.responseSchema
        }
      }];
      body.tool_choice = {
        type: 'function',
        function: { name: STRUCTURED_RESULT_TOOL }
      };
    } else if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      }));
      body.tool_choice = openAIToolChoice(request.toolChoice);
    }
    return {
      url: providerEndpoint(this.config.baseUrl, 'chat/completions'),
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

function toOpenAIMessage(message: ProviderRequest['messages'][number]): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.content
    };
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) }
      }))
    };
  }
  return { role: message.role, content: message.content };
}

function openAIToolChoice(choice: ProviderRequest['toolChoice']): unknown {
  if (!choice || choice === 'auto' || choice === 'none' || choice === 'required') return choice ?? 'auto';
  return { type: 'function', function: { name: choice.name } };
}

function isUnsupportedStructuredRequest(error: unknown): boolean {
  return error instanceof ProviderGatewayError && error.kind === ProviderErrorKind.InvalidRequest;
}

function structuredJsonInstruction(system: string, schema: object): string {
  return `${system}\n\n<structured_output>\n仅输出一个符合下列 JSON Schema 的 JSON 对象，不要输出 Markdown 代码围栏、解释或其他文字。\n${JSON.stringify(schema)}\n</structured_output>`;
}

function providerEndpoint(baseUrl: string, path: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.endsWith(`/${path}`) ? normalized : `${normalized}/${path}`;
}
