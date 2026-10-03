import {
  ProviderCode,
  ProviderErrorKind,
  ProviderGatewayError,
  type ProviderGateway,
  type ModelContentPart,
  type ModelReasoningBlock,
  type ProviderRequest,
  type ProviderResponse,
  type ProviderTextDelta
} from '../contracts/ProviderGateway';
import { FetchHttpTransport, type HttpTransport } from '../contracts/HttpTransport';
import {
  assertNonEmptyProviderResult,
  assertProviderResponse,
  interruptedProviderStream,
  isHtmlResponse,
  isStreamPayloadError,
  unreadableProviderResponse
} from './ProviderHttpSupport';
import {
  AnthropicStreamAccumulator,
  anthropicResponseHasReasoning,
  parseAnthropicResponse
} from './ProviderResponseParser';
import { readServerSentEvents } from './SseReader';
import { anthropicThinkingPolicy } from './AnthropicThinkingPolicy';
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
  /** Opt a compatible proxy into native binding controls only when it supports the beta. */
  readonly thinkingBindingControls?: boolean;
}

const STRUCTURED_RESULT_TOOL = 'submit_structured_result';

export class AnthropicGateway implements ProviderGateway {
  readonly provider = ProviderCode.Anthropic;
  get capabilities() {
    return { multimodalInput: true, forcedToolChoice: this.modelCapabilities.forcedToolChoice };
  }
  readonly model: string;
  private readonly config: AnthropicGatewayConfig;
  private readonly structuredOutput: StructuredOutputCapability;
  private readonly modelCapabilities: ModelCapabilityMatrix;

  constructor(
    config: AnthropicGatewayConfig,
    private readonly transport: HttpTransport = new FetchHttpTransport(),
    capabilityOverrides: ModelRequestCapabilityOverrides = {}
  ) {
    this.model = normalizeAnthropicModelName(config.baseUrl, config.model);
    this.config = { ...config, model: this.model };
    this.structuredOutput = new StructuredOutputCapability(
      `anthropic:${normalizedCapabilityEndpoint(config.baseUrl)}:${this.model}`
    );
    this.modelCapabilities = new ModelCapabilityMatrix(capabilityOverrides, this.model);
  }

  async complete(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    try {
      return await this.completeWithCurrentCapabilities(request, signal);
    } catch (error) {
      if (!this.learnFromInvalidRequest(error, request)) throw error;
      return this.completeWithCurrentCapabilities(request, signal);
    }
  }

  async prepareStructuredOutput(signal?: AbortSignal): Promise<void> {
    if (!this.capabilities.forcedToolChoice) return;
    const request = structuredOutputProbeRequest();
    await this.structuredOutput.execute({
      invoke: (mode) => this.sendCompletion(request, mode, signal),
      acceptsToolResult: (result) => hasRequiredStructuredRoot(result.text, request.responseSchema!),
      isToolModeUnsupported: isUnsupportedStructuredRequest
    });
  }

  private async completeWithCurrentCapabilities(
    request: ProviderRequest,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    if (!request.responseSchema) return this.sendCompletion(request, 'tool', signal);
    if (request.structuredOutputMode === 'prompt' || !this.capabilities.forcedToolChoice) {
      return this.sendCompletion(request, 'prompt', signal);
    }
    return this.structuredOutput.execute({
      invoke: (mode) => this.sendCompletion(request, mode, signal),
      acceptsToolResult: (result) => hasRequiredStructuredRoot(result.text, request.responseSchema!),
      isToolModeUnsupported: isUnsupportedStructuredRequest
    });
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
      if (!this.learnFromInvalidRequest(error, request)) throw error;
      return this.stream(request, onEvent, signal);
    }
    if (!response.body) return this.complete(request, signal);
    if (isHtmlResponse(response)) throw unreadableProviderResponse(response, 'Anthropic 兼容');
    const accumulator = new AnthropicStreamAccumulator();
    let events = 0;
    try {
      await readServerSentEvents(response.body, async (data) => {
        events += 1;
        // Some Anthropic-compatible proxies append the OpenAI sentinel.
        if (data === '[DONE]') return;
        const delta = accumulator.append(JSON.parse(data) as unknown);
        if (!delta) return;
        await onEvent({ type: 'text_delta', text: delta });
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof ProviderGatewayError) throw error;
      if (!isStreamPayloadError(error)) throw interruptedProviderStream(error instanceof Error ? error.message : undefined);
      throw new ProviderGatewayError('Anthropic 兼容接口的流式响应格式无法识别', ProviderErrorKind.Protocol);
    }
    // A body that ends before message_stop is a broken stream, not a short answer.
    if (!accumulator.isComplete) {
      if (!events) throw new ProviderGatewayError('Anthropic 兼容接口没有返回流式模型响应', ProviderErrorKind.Protocol);
      throw interruptedProviderStream();
    }
    return assertNonEmptyProviderResult(accumulator.response(), accumulator.sawReasoning);
  }

  private async sendCompletion(
    request: ProviderRequest,
    structuredMode: StructuredOutputMode,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    const response = await this.transport.send(this.httpRequest(request, false, structuredMode, signal));
    await assertProviderResponse(response);
    try {
      const payload: unknown = await response.json();
      return assertNonEmptyProviderResult(parseAnthropicResponse(payload), anthropicResponseHasReasoning(payload));
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof ProviderGatewayError) throw error;
      throw unreadableProviderResponse(response, 'Anthropic 兼容');
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
      tool_choice: anthropicToolChoice(request.toolChoice, this.capabilities.forcedToolChoice)
    } : {};
    const system = request.responseSchema && structuredMode === 'prompt'
      ? structuredJsonInstruction(request.system, request.responseSchema)
      : request.system;
    // Once the endpoint refused the disable it is no longer sent, and thinking is back on.
    const thinkingParameters = this.modelCapabilities.thinkingParameters(this.disabledThinking(request));
    const thinkingDisabled = 'thinking' in thinkingParameters;
    const thinkingPolicy = anthropicThinkingPolicy(this.config.baseUrl, this.model, this.config.thinkingBindingControls);
    return {
      url: anthropicMessagesEndpoint(this.config.baseUrl),
      method: 'POST' as const,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': this.config.anthropicVersion ?? '2023-06-01',
        ...thinkingPolicy.headers,
        'X-Client-Request-Id': request.requestId
      },
      body: JSON.stringify({
        model: this.config.model,
        system,
        // A disabled-thinking request (DeepSeek tool chains) replays no thinking blocks.
        messages: toAnthropicMessages(request.messages, !thinkingDisabled && thinkingPolicy.replayReasoning),
        max_tokens: request.maxOutputTokens,
        stream,
        ...this.modelCapabilities.samplingParameters(request.temperature),
        ...thinkingParameters,
        ...(thinkingPolicy.thinking ? { thinking: thinkingPolicy.thinking } : {}),
        ...structuredOutput
      }),
      signal
    };
  }

  /**
   * DeepSeek thinks by default and then requires its thinking blocks back on
   * every later tool turn, so its tool chains stay thinking-free: thinking is
   * disabled for any request that belongs to a tool chain — including a
   * finalization turn that offers no tools but carries tool_use/tool_result
   * history — for structured output, and on request. This keys on the host,
   * not the model name: DeepSeek maps Claude-style names (claude-opus-* to
   * deepseek-v4-pro) onto its own models, which accept the disable. Native
   * Claude never reaches this branch; its thinking follows AnthropicThinkingPolicy.
   */
  private disabledThinking(request: ProviderRequest): { readonly type: 'disabled' } | undefined {
    const toolChain = Boolean(request.tools?.length)
      || request.messages.some((message) => message.role === 'tool' || Boolean(message.toolCalls?.length));
    const wanted = toolChain || Boolean(request.responseSchema) || request.thinking === 'disabled';
    return wanted && requiresDisabledThinkingForToolUse(this.config.baseUrl) ? { type: 'disabled' } : undefined;
  }

  private learnFromInvalidRequest(error: unknown, request: ProviderRequest): boolean {
    return this.modelCapabilities.learnFromInvalidRequest(error, {
      thinking: Boolean(this.disabledThinking(request))
    });
  }
}

function structuredOutputProbeRequest(): ProviderRequest {
  return {
    system: 'Return the requested structured result.',
    messages: [{ role: 'user', content: 'Set ok to true.' }],
    temperature: 0,
    maxOutputTokens: 64,
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } }
    },
    requestId: `structured-probe-${Date.now()}`
  };
}

function normalizedCapabilityEndpoint(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').toLowerCase();
}

function toAnthropicMessages(
  messages: ProviderRequest['messages'],
  replayReasoning: boolean
): Array<Record<string, unknown>> {
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
    const reasoning = replayReasoning && message.role === 'assistant' ? message.reasoning ?? [] : [];
    if (message.role === 'assistant' && (message.toolCalls?.length || reasoning.length)) {
      const text = toAnthropicContent(message.content);
      const calls = (message.toolCalls ?? []).map((call) => ({
        type: 'tool_use',
        id: call.id,
        name: call.name,
        input: call.arguments
      }));
      result.push({ role: 'assistant', content: interleaveReasoning(reasoning, text, calls) });
    } else {
      result.push({ role: message.role, content: toAnthropicContent(message.content) });
    }
    index += 1;
  }
  return result;
}

/**
 * Thinking blocks go back unchanged and where they were: a block is bound to
 * everything before it, so a progress update keeps its place ahead of the
 * tool_use it introduced. Blocks without a recorded placement (leading
 * blocks, older records) go first, as they always did.
 */
function interleaveReasoning(
  reasoning: readonly ModelReasoningBlock[],
  text: readonly Record<string, unknown>[],
  calls: readonly Record<string, unknown>[]
): Array<Record<string, unknown>> {
  const sequence = [...text, ...calls];
  const slotOf = ({ placement }: ModelReasoningBlock): number => {
    if (!placement) return 0;
    const toolCallsBefore = Math.min(calls.length, Math.max(0, Math.floor(placement.toolCallsBefore) || 0));
    return (placement.afterText || toolCallsBefore ? text.length : 0) + toolCallsBefore;
  };
  const content: Array<Record<string, unknown>> = [];
  for (let slot = 0; slot <= sequence.length; slot += 1) {
    reasoning.filter((block) => slotOf(block) === slot).forEach((block) => content.push(toAnthropicReasoning(block)));
    if (slot < sequence.length) content.push(sequence[slot]!);
  }
  return content;
}

function toAnthropicReasoning(block: ModelReasoningBlock): Record<string, unknown> {
  return block.type === 'redacted_thinking'
    ? { type: 'redacted_thinking', data: block.data ?? '' }
    : { type: 'thinking', thinking: block.thinking ?? '', ...(block.signature ? { signature: block.signature } : {}) };
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

function anthropicToolChoice(choice: ProviderRequest['toolChoice'], canForce: boolean): unknown {
  if (!choice || choice === 'auto') return { type: 'auto' };
  if (choice === 'none') return { type: 'none' };
  if (!canForce) return { type: 'auto' };
  if (choice === 'required') return { type: 'any' };
  return { type: 'tool', name: choice.name };
}

function isUnsupportedStructuredRequest(error: unknown): boolean {
  return error instanceof ProviderGatewayError && (
    error.kind === ProviderErrorKind.InvalidRequest
    || error.kind === ProviderErrorKind.EmptyResponse
  );
}

function structuredJsonInstruction(system: string, schema: object): string {
  return `${system}\n\n<structured_output>\n仅输出一个符合下列 JSON Schema 的 JSON 对象，不要输出 Markdown 代码围栏、解释或其他文字。\n${JSON.stringify(schema)}\n</structured_output>`;
}
