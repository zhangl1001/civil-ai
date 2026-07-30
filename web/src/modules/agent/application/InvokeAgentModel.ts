import {
  AI_EXECUTION_BUDGET,
  createProviderExecutionDeadline,
  InvocationValidationStatus,
  ModelMessageRole,
  ProviderErrorKind,
  ProviderGatewayError,
  type ModelMessage,
  type ProviderGateway,
  type ProviderRequest,
  type ProviderResponse,
  type ProviderToolDefinition
} from '@/capabilities/ai-runtime/public';
import type { UnitOfWork } from '@/capabilities/database/public';
import {
  sha256Json,
  type AgentRunId,
  type Clock,
  type IdGenerator,
  type JsonObject,
  type JsonValue,
  type PromptVersionId
} from '@/kernel/public';
import type { AgentRunRepository } from '../contracts/AgentRunRepository';
import type { AgentRunLeaseToken } from '../contracts/AgentRunRepository';
import type { AgentModelInvocation, AgentModelInvoker } from '../contracts/AgentRuntimePorts';

export interface InvokeAgentModelCommand {
  readonly agentRunId: AgentRunId;
  readonly leaseToken?: AgentRunLeaseToken;
  readonly modelRole: string;
  readonly system: string;
  readonly user?: string;
  readonly messages?: readonly ModelMessage[];
  readonly promptVersionId?: PromptVersionId;
  readonly toolSchemaVersion?: string;
  readonly responseSchema?: JsonObject;
  readonly tools?: readonly ProviderToolDefinition[];
  readonly toolChoice?: 'auto' | 'none' | 'required' | { readonly name: string };
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly preferStream?: boolean;
  readonly onDelta?: (text: string) => void | Promise<void>;
}

export interface InvokeAgentModelResult {
  readonly invocationId: string;
  readonly text: string;
  readonly response: ProviderResponse;
}

export class InvokeAgentModel implements AgentModelInvoker {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: AgentRunRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async invoke(
    invocation: AgentModelInvocation,
    gateway: ProviderGateway,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    const result = await this.execute({
      agentRunId: invocation.agentRunId,
      leaseToken: invocation.leaseToken,
      modelRole: invocation.modelRole,
      system: invocation.system,
      messages: invocation.messages,
      toolSchemaVersion: invocation.toolSchemaVersion,
      tools: invocation.tools,
      toolChoice: invocation.toolChoice,
      temperature: invocation.temperature,
      maxOutputTokens: invocation.maxOutputTokens,
      preferStream: invocation.preferStream,
      onDelta: invocation.onDelta
    }, gateway, signal);
    return result.response;
  }

  async execute(
    command: InvokeAgentModelCommand,
    gateway: ProviderGateway,
    signal?: AbortSignal
  ): Promise<InvokeAgentModelResult> {
    const run = await this.repository.findById(command.agentRunId);
    const messages = command.messages?.length
      ? command.messages
      : command.user?.trim()
        ? [{ role: ModelMessageRole.User, content: command.user.trim() }]
        : [];
    if (!run || run.run.status !== 'running') {
      throw new Error(`Agent run is not active: ${command.agentRunId}`);
    }
    if (
      command.leaseToken
      && !await this.repository.hasActiveLease(command.leaseToken, this.clock.now())
    ) {
      throw new Error(`Agent run lease conflict: ${command.agentRunId}`);
    }
    if (!command.modelRole.trim() || !command.system.trim() || !messages.length) {
      throw new Error('Agent model invocation requires role and prompt');
    }

    signal?.throwIfAborted();
    const invocationId = this.ids.next('AiInvocationId');
    const requestHash = await sha256Json({
      provider: gateway.provider,
      model: gateway.model,
      system: command.system,
      messages: messages.map((message) => ({
        role: message.role,
        content: hashableMessageContent(message.content)
      })),
      responseSchema: command.responseSchema ?? null,
      tools: command.tools?.map((tool) => ({
        name: tool.name,
        inputSchema: tool.inputSchema
      })) ?? []
    });
    const started = Number(this.clock.monotonicNowMs());
    await this.unitOfWork.runAutocommit((context) => this.repository.appendInvocation({
      id: invocationId,
      agentRunId: command.agentRunId,
      provider: gateway.provider,
      model: gateway.model,
      modelRole: command.modelRole.trim(),
      promptVersionId: command.promptVersionId,
      toolSchemaVersion: command.toolSchemaVersion,
      requestHash,
      validationStatus: InvocationValidationStatus.Pending,
      createdAt: this.clock.now()
    }, context));

    const deadline = createProviderExecutionDeadline(
      signal,
      AI_EXECUTION_BUDGET.modelTurnMs,
      'AI 响应'
    );
    try {
      const request = {
        system: command.system,
        messages,
        temperature: command.temperature ?? 0.2,
        maxOutputTokens: command.maxOutputTokens ?? 8_192,
        responseSchema: command.responseSchema,
        tools: command.tools,
        toolChoice: command.toolChoice,
        requestId: invocationId
      };
      const shouldStream = Boolean(command.preferStream && gateway.stream && command.onDelta);
      const response = await invokeProviderWithRecovery(
        gateway,
        request,
        shouldStream ? command.onDelta : undefined,
        deadline.signal,
        command.leaseToken ? WORKER_PROVIDER_ATTEMPT_LIMIT : INTERACTIVE_PROVIDER_ATTEMPT_LIMIT
      );
      signal?.throwIfAborted();
      if (
        command.leaseToken
        && !await this.repository.hasActiveLease(command.leaseToken, this.clock.now())
      ) {
        throw new Error(`Agent run lease conflict: ${command.agentRunId}`);
      }
      if (command.onDelta && !shouldStream) {
        await command.onDelta(response.text);
      }
      await this.unitOfWork.run(async (context) => {
        await this.repository.updateInvocationResult(invocationId, {
          providerRequestId: response.providerRequestId,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          latencyMs: Math.max(0, Number(this.clock.monotonicNowMs()) - started),
          finishReason: response.finishReason
        }, context);
        await this.repository.updateInvocationValidation(
          invocationId,
          InvocationValidationStatus.Valid,
          undefined,
          context
        );
      });
      return { invocationId, text: response.text, response };
    } catch (error) {
      const code = signal?.aborted
        ? 'agent.invocation_cancelled'
        : error instanceof ProviderGatewayError
          ? `provider.${error.kind}`
          : 'agent.invocation_failed';
      try {
        await this.unitOfWork.runAutocommit((context) => this.repository.updateInvocationValidation(
          invocationId,
          signal?.aborted ? InvocationValidationStatus.Cancelled : InvocationValidationStatus.Invalid,
          code,
          context
        ));
      } catch {
        // Preserve the provider error; ledger updates are secondary on failure.
      }
      throw error;
    } finally {
      deadline.dispose();
    }
  }
}

function hashableMessageContent(content: ModelMessage['content']): JsonValue {
  if (typeof content === 'string') return content;
  return content.map((part): JsonObject => part.type === 'text'
    ? { type: 'text', text: part.text }
    : {
        type: 'image',
        mediaType: part.mediaType,
        attachmentId: part.attachmentId || null,
        encodedBytes: part.dataBase64.length
      });
}

function canFallbackFromStream(
  error: unknown,
  emittedDelta: boolean,
  deadlineAborted: boolean
): boolean {
  if (emittedDelta || deadlineAborted || !(error instanceof ProviderGatewayError)) return false;
  return error.kind === ProviderErrorKind.InvalidRequest
    || error.kind === ProviderErrorKind.EmptyResponse
    || error.kind === ProviderErrorKind.Protocol;
}

async function invokeProviderWithRecovery(
  gateway: ProviderGateway,
  request: ProviderRequest,
  onDelta: ((text: string) => void | Promise<void>) | undefined,
  signal: AbortSignal,
  attemptLimit: number
): Promise<ProviderResponse> {
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    signal.throwIfAborted();
    let emittedDelta = false;
    try {
      if (!onDelta || !gateway.stream) return await gateway.complete(request, signal);
      try {
        return await gateway.stream(request, async (event) => {
          emittedDelta ||= Boolean(event.text);
          await onDelta(event.text);
        }, signal);
      } catch (error) {
        if (!canFallbackFromStream(error, emittedDelta, signal.aborted)) throw error;
        const response = await gateway.complete(request, signal);
        await onDelta(response.text);
        return response;
      }
    } catch (error) {
      if (!canRetryProviderTurn(error, emittedDelta, signal, attempt, attemptLimit)) throw error;
      await waitForProviderRetry(providerRetryDelayMs(error, attempt), signal);
    }
  }
  throw new Error('AI provider recovery exhausted unexpectedly');
}

function canRetryProviderTurn(
  error: unknown,
  emittedDelta: boolean,
  signal: AbortSignal,
  attempt: number,
  attemptLimit: number
): boolean {
  if (emittedDelta || signal.aborted || attempt >= attemptLimit - 1) return false;
  if (!(error instanceof ProviderGatewayError)) return false;
  return error.kind === ProviderErrorKind.EmptyResponse
    || error.kind === ProviderErrorKind.Transient
    || error.kind === ProviderErrorKind.RateLimited;
}

function providerRetryDelayMs(error: unknown, attempt: number): number {
  const providerDelay = error instanceof ProviderGatewayError ? error.retryAfterMs : undefined;
  return providerDelay !== undefined && Number.isFinite(providerDelay)
    ? Math.max(0, providerDelay)
    : Math.min(5_000, 250 * 2 ** attempt);
}

function waitForProviderRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(done, Math.max(0, delayMs));
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'));
    };
    function done() {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const INTERACTIVE_PROVIDER_ATTEMPT_LIMIT = 4;
const WORKER_PROVIDER_ATTEMPT_LIMIT = 1;
