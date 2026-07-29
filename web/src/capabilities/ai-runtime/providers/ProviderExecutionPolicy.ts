import { ProviderErrorKind, ProviderGatewayError } from '../contracts/ProviderGateway';

export const AI_EXECUTION_BUDGET = {
  modelTurnMs: 180_000,
  chatRunMs: 900_000,
  generationBaseMs: 120_000,
  generationPerQuestionMs: 8_000,
  generationMaxMs: 300_000
} as const;

export interface ProviderExecutionDeadline {
  readonly signal: AbortSignal;
  dispose(): void;
}

export function generationExecutionBudgetMs(questionCount: number): number {
  const count = Number.isFinite(questionCount) ? Math.max(1, Math.floor(questionCount)) : 1;
  return Math.min(
    AI_EXECUTION_BUDGET.generationMaxMs,
    AI_EXECUTION_BUDGET.generationBaseMs + count * AI_EXECUTION_BUDGET.generationPerQuestionMs
  );
}

export function createProviderExecutionDeadline(
  parent: AbortSignal | undefined,
  timeoutMs: number,
  operation: string
): ProviderExecutionDeadline {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
    throw new RangeError('AI execution timeout must be at least one second');
  }
  const controller = new AbortController();
  const abortFromParent = () => {
    controller.abort(parent?.reason ?? new DOMException('Request aborted', 'AbortError'));
  };
  if (parent?.aborted) {
    abortFromParent();
  } else {
    parent?.addEventListener('abort', abortFromParent, { once: true });
  }
  const timer = globalThis.setTimeout(() => {
    controller.abort(new ProviderGatewayError(
      `${operation}超时，请稍后重试或减少本次生成数量。`,
      ProviderErrorKind.Transient
    ));
  }, timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      globalThis.clearTimeout(timer);
      parent?.removeEventListener('abort', abortFromParent);
    }
  };
}
