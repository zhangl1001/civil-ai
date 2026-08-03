import {
  InvocationValidationStatus,
  ProviderErrorKind,
  ProviderGatewayError,
  type AIInvocation,
  type AIInvocationRepository,
  type ProviderGateway,
  type ProviderRequest,
  type ProviderResponse
} from '@/capabilities/ai-runtime/public';
import type { UnitOfWork } from '@/capabilities/database/public';
import {
  abortableDelay,
  sha256Json,
  type Clock,
  type IdGenerator,
  type JsonValue
} from '@/kernel/public';
import type { GenerationAggregate } from '../contracts/GenerationRepository';
import { generationRequestScheduler } from './GenerationRequestScheduler';

export class GenerationModelInvoker {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly invocationRepository: AIInvocationRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async invokeWithRetry(
    aggregate: GenerationAggregate,
    gateway: ProviderGateway,
    request: Omit<ProviderRequest, 'requestId'>,
    modelRole: string,
    signal: AbortSignal,
    maxAttempts = 2
  ): Promise<{ readonly invocationId: AIInvocation['id']; readonly response: ProviderResponse }> {
    const attempts = Math.max(1, Math.min(2, Math.floor(maxAttempts)));
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      signal.throwIfAborted();
      try {
        return await this.invoke(
          aggregate,
          gateway,
          request,
          attempt === 1 ? modelRole : `${modelRole}_retry_${attempt}`,
          signal
        );
      } catch (error) {
        lastError = error;
        if (attempt >= attempts || !isRetryableProviderFailure(error, signal)) throw error;
        await abortableDelay(retryDelayMs(error, attempt), signal);
      }
    }
    throw lastError;
  }

  async invoke(
    aggregate: GenerationAggregate,
    gateway: ProviderGateway,
    request: Omit<ProviderRequest, 'requestId'>,
    modelRole: string,
    signal: AbortSignal
  ): Promise<{ readonly invocationId: AIInvocation['id']; readonly response: ProviderResponse }> {
    const effectiveRequest: Omit<ProviderRequest, 'requestId'> = request;
    const invocationId = this.ids.next('AiInvocationId');
    const requestHash = await sha256Json(toJson({
      provider: gateway.provider,
      model: gateway.model,
      ...effectiveRequest
    }));
    const invocation: AIInvocation = {
      id: invocationId,
      workflowId: aggregate.workflow.id,
      provider: gateway.provider,
      model: gateway.model,
      modelRole,
      promptVersionId: aggregate.spec.promptVersionId,
      contentSchemaVersionId: aggregate.spec.contentSchemaVersionId,
      requestHash,
      validationStatus: InvocationValidationStatus.Pending,
      createdAt: this.clock.now()
    };
    await this.unitOfWork.runAutocommit((context) => (
      this.invocationRepository.append(invocation, context)
    ));
    const started = Number(this.clock.monotonicNowMs());
    try {
      const response = await generationRequestScheduler.run(
        () => gateway.complete({ ...effectiveRequest, requestId: invocationId }, signal),
        signal
      );
      await this.unitOfWork.runAutocommit((context) => this.invocationRepository.updateResult(
        invocationId,
        {
          providerRequestId: response.providerRequestId,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          latencyMs: Math.max(0, Number(this.clock.monotonicNowMs()) - started),
          finishReason: response.finishReason
        },
        context
      ));
      if (import.meta.env.DEV && typeof window !== 'undefined') {
        console.info('[GenerationInvocation]', JSON.stringify({
          role: modelRole,
          latencyMs: Math.max(0, Number(this.clock.monotonicNowMs()) - started),
          finishReason: response.finishReason ?? null,
          outputTokens: response.usage.outputTokens ?? null
        }));
      }
      return { invocationId, response };
    } catch (error) {
      if (import.meta.env.DEV && typeof window !== 'undefined') {
        console.warn('[GenerationInvocation]', JSON.stringify({
          role: modelRole,
          latencyMs: Math.max(0, Number(this.clock.monotonicNowMs()) - started),
          error: error instanceof Error ? error.message : String(error)
        }));
      }
      await this.markInvalid(invocationId, invocationErrorCode(error, signal.aborted));
      throw error;
    }
  }

  markInvalid(invocationId: AIInvocation['id'], code: string): Promise<void> {
    return this.unitOfWork.runAutocommit((context) => (
      this.invocationRepository.updateValidation(
        invocationId,
        InvocationValidationStatus.Invalid,
        code,
        context
      )
    ));
  }
}

function isRetryableProviderFailure(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return false;
  if (error instanceof ProviderGatewayError) {
    return error.kind === ProviderErrorKind.RateLimited
      || error.kind === ProviderErrorKind.Transient
      || error.kind === ProviderErrorKind.EmptyResponse
      || error.kind === ProviderErrorKind.Protocol;
  }
  return error instanceof Error && error.name === 'AbortError';
}

function retryDelayMs(error: unknown, failedAttempt: number): number {
  const providerDelay = error instanceof ProviderGatewayError ? error.retryAfterMs : undefined;
  if (providerDelay !== undefined && Number.isFinite(providerDelay)) {
    return Math.max(250, Math.min(12_000, providerDelay));
  }
  return Math.min(4_000, 750 * 2 ** Math.max(0, failedAttempt - 1));
}

function invocationErrorCode(error: unknown, cancelled: boolean): string {
  if (cancelled) return 'generation.cancelled';
  if (error instanceof Error && error.name === 'AbortError') {
    return 'generation.process_interrupted';
  }
  if (error instanceof ProviderGatewayError) return `provider.${error.kind}`;
  return 'generation.unexpected_failure';
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
