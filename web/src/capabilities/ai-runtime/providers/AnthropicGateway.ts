import {
  ProviderCode,
  ProviderErrorKind,
  ProviderGatewayError,
  type ProviderGateway,
  type ModelContentPart,
  type ProviderRequest,
  type ProviderResponse,
  type ProviderTextDelta
} from '../contracts/ProviderGateway';
import { FetchHttpTransport, type HttpTransport } from '../contracts/HttpTransport';
import { assertNonEmptyProviderResult, assertProviderResponse } from './ProviderHttpSupport';
import { AnthropicStreamAccumulator, parseAnthropicResponse } from './ProviderResponseParser';
import { readServerSentEvents } from './SseReader';
import {
  hasRequiredStructuredRoot,
  StructuredOutputCapability,
  type StructuredOutputMode
} from './StructuredOutputCapability';
import {
  ModelCapabilityMatrix,
  type ModelRequestCapabilityOverrides
} from './ModelCapabilityMatrix';
import {
  anthropicInputSchema,
  anthropicMessagesEndpoint,
  normalizeAnthropicModelName,
  requiresDisabledThinkingForToolUse
} from './AnthropicCompatibility';

export interface AnthropicGatewayConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly anthropicVersion?: string;
}

const STRUCTURED_RESULT_TOOL = 'submit_structured_result';

export class AnthropicGateway implements ProviderGateway {
  readonly provider = ProviderCode.Anthropic;
  readonly capabilities = { multimodalInput: true } as const;
  readonly model: string;
  private readonly config: AnthropicGatewayConfig;
  private readonly structuredOutput = new StructuredOutputCapability();
  private readonly modelCapabilities: ModelCapabilityMatrix;

  constructor(
    config: AnthropicGatewayConfig,
    private readonly transport: HttpTransport = new FetchHttpTransport(),
    capabilityOverrides: ModelRequestCapabilityOverrides = {}
  ) {
    this.model = normalizeAnthropicModelName(config.baseUrl, config.model);
    this.config = { ...config, model: this.model };
    this.modelCapabilities = new ModelCapabilityMatrix(capabilityOverrides);
  }

  async complete(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    try {
      return await this.completeWithCurrentCapabilities(request, signal);
    } catch (error) {
      if (!this.modelCapabilities.learnFromInvalidRequest(error)) throw error;
      return this.completeWithCurrentCapabilities(request, signal);
    }
  }

  private async completeWithCurrentCapabilities(
    request: ProviderRequest,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    const mode = request.responseSchema ? this.structuredOutput.current() : 'tool';
    try {
      const result = await this.sendCompletion(request, mode, signal);
      if (
        mode === 'tool'
        && request.responseSchema
        && !hasRequiredStructuredRoot(result.text, request.responseSchema)
      ) {
        this.structuredOutput.markToolModeUnsupported();
        return this.sendCompletion(request, 'prompt', signal);
      }
      return result;
    } catch (error) {
      if (mode !== 'tool' || !request.responseSchema || !isUnsupportedStructuredRequest(error)) throw error;
      this.structuredOutput.markToolModeUnsupported();
      return this.sendCompletion(request, 'prompt', signal);
    }
  }

  async stream(
    request: ProviderRequest,
    onEvent: (event: ProviderTextDelta) => void | Promise<void>,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    // Structured generation is returned as a tool_use block, not text deltas.
    // Route it through complete() so every caller receives the same JSON contract.
    if (request.responseSchema) {
      const result = await this.complete(request, signal);
      await onEvent({ type: 'text_delta', text: result.text });
      return result;
    }
    let response: Response;
    try {
      response = await this.transport.send(this.httpRequest(request, true, 'none', signal));
      await assertProviderResponse(response);
    } catch (error) {
      if (!this.modelCapabilities.learnFromInvalidRequest(error)) throw error;
      return this.stream(request, onEvent, signal);
    }
    if (!response.body) return this.complete(request, signal);
    const accumulator = new AnthropicStreamAccumulator();
    try {
      await readServerSentEvents(response.body, async (data) => {
        const delta = accumulator.append(JSON.parse(data) as unknown);
        if (!delta) return;
        await onEvent({ type: 'text_delta', text: delta });
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof ProviderGatewayError) throw error;
      throw new ProviderGatewayError('Anthropic stream protocol is invalid', ProviderErrorKind.Protocol);
    }
    return assertNonEmptyProviderResult(accumulator.response());
  }

  private async sendCompletion(
    request: ProviderRequest,
    structuredMode: StructuredOutputMode,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    const response = await this.transport.send(this.httpRequest(request, false, structuredMode, signal));
    await assertProviderResponse(response);
    try {
      return assertNonEmptyProviderResult(parseAnthropicResponse(await response.json()));
    } catch (error) {
      if (error instanceof ProviderGatewayError) throw error;
      throw new ProviderGatewayError(
        'Anthropic-compatible provider returned an invalid response format',
        ProviderErrorKind.Protocol
      );
    }
  }

  private httpRequest(
    request: ProviderRequest,
    stream: boolean,
    structuredMode: 'none' | StructuredOutputMode,
    signal?: AbortSignal
  ) {
    if (request.responseSchema && request.tools?.length) {
      throw new Error('Structured response schema and Agent tools cannot be requested together');
    }
    const structuredOutput: Record<string, unknown> = request.responseSchema && structuredMode === 'tool' ? {
      tools: [{
        name: STRUCTURED_RESULT_TOOL,
        description: '提交严格符合输入 Schema 的最终结构化结果，不要把结果放在普通文本中。',
        input_schema: anthropicInputSchema(this.config.baseUrl, request.responseSchema)
      }],
      tool_choice: {
        type: 'tool',
        name: STRUCTURED_RESULT_TOOL
      }
    } : request.tools?.length ? {
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: anthropicInputSchema(this.config.baseUrl, tool.inputSchema)
      })),
      tool_choice: anthropicToolChoice(request.toolChoice)
    } : {};
    const system = request.responseSchema && structuredMode === 'prompt'
      ? structuredJsonInstruction(request.system, request.responseSchema)
      : request.system;
    // Some compatible providers require every thinking block to be replayed
    // on later tool turns. Reasoning is intentionally not persisted, so keep
    // thinking disabled for the whole tool chain on those providers.
    const usesTools = structuredMode === 'tool' && Boolean(request.responseSchema)
      || Boolean(request.tools?.length);
    const thinkingCompatibility = usesTools
      && requiresDisabledThinkingForToolUse(this.config.baseUrl)
      ? { thinking: { type: 'disabled' } }
      : {};
    return {
      url: anthropicMessagesEndpoint(this.config.baseUrl),
      method: 'POST' as const,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': this.config.anthropicVersion ?? '2023-06-01',
        'X-Client-Request-Id': request.requestId
      },
      body: JSON.stringify({
        model: this.config.model,
        system,
        messages: toAnthropicMessages(request.messages),
        max_tokens: request.maxOutputTokens,
        stream,
        ...this.modelCapabilities.samplingParameters(request.temperature),
        ...thinkingCompatibility,
        ...structuredOutput
      }),
      signal
    };
  }
}

function toAnthropicMessages(messages: ProviderRequest['messages']): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (message.role === 'tool') {
      const content: Array<Record<string, unknown>> = [];
      while (index < messages.length && messages[index].role === 'tool') {
        const toolResult = messages[index];
        content.push({
          type: 'tool_result',
          tool_use_id: toolResult.toolCallId,
          content: toolResult.content
        });
        index += 1;
      }
      result.push({ role: 'user', content });
      continue;
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const content: Array<Record<string, unknown>> = [];
      content.push(...toAnthropicContent(message.content));
      message.toolCalls.forEach((call) => content.push({
        type: 'tool_use',
        id: call.id,
        name: call.name,
        input: call.arguments
      }));
      result.push({ role: 'assistant', content });
    } else {
      result.push({ role: message.role, content: toAnthropicContent(message.content) });
    }
    index += 1;
  }
  return result;
}

function toAnthropicContent(content: ProviderRequest['messages'][number]['content']): Array<Record<string, unknown>> {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  return content.map((part: ModelContentPart) => part.type === 'text'
    ? { type: 'text', text: part.text }
    : {
        type: 'image',
        source: {
          type: 'base64',
          media_type: part.mediaType,
          data: part.dataBase64
        }
      });
}

function anthropicToolChoice(choice: ProviderRequest['toolChoice']): unknown {
  if (!choice || choice === 'auto') return { type: 'auto' };
  if (choice === 'none') return { type: 'none' };
  if (choice === 'required') return { type: 'any' };
  return { type: 'tool', name: choice.name };
}

function isUnsupportedStructuredRequest(error: unknown): boolean {
  return error instanceof ProviderGatewayError && error.kind === ProviderErrorKind.InvalidRequest;
}

function structuredJsonInstruction(system: string, schema: object): string {
  return `${system}\n\n<structured_output>\n仅输出一个符合下列 JSON Schema 的 JSON 对象，不要输出 Markdown 代码围栏、解释或其他文字。\n${JSON.stringify(schema)}\n</structured_output>`;
}
