import {
  InvocationValidationStatus,
  ProviderGatewayError,
  type AIInvocation,
  type AIInvocationRepository,
  type ProviderGateway,
  type ProviderRequest,
  type ProviderResponse
} from '@/capabilities/ai-runtime/public';
import type { UnitOfWork } from '@/capabilities/database/public';
import {
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

  async invoke(
    aggregate: GenerationAggregate,
    gateway: ProviderGateway,
    request: Omit<ProviderRequest, 'requestId'>,
    modelRole: string,
    signal: AbortSignal
  ): Promise<{ readonly invocationId: AIInvocation['id']; readonly response: ProviderResponse }> {
    const invocationId = this.ids.next('AiInvocationId');
    const requestHash = await sha256Json(toJson({
      provider: gateway.provider,
      model: gateway.model,
      ...request
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
        () => gateway.complete({ ...request, requestId: invocationId }, signal),
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
      return { invocationId, response };
    } catch (error) {
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
