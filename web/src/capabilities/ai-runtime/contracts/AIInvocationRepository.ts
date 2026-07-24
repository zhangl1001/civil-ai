import type { TransactionContext } from '@/capabilities/database/public';
import type {
  AiInvocationId,
  ContentSchemaVersionId,
  InstantMs,
  PromptVersionId,
  WorkflowId
} from '@/kernel/public';

export const InvocationValidationStatus = {
  Pending: 'pending',
  Valid: 'valid',
  Invalid: 'invalid',
  Cancelled: 'cancelled'
} as const;

export type InvocationValidationStatus = typeof InvocationValidationStatus[keyof typeof InvocationValidationStatus];

export interface AIInvocation {
  readonly id: AiInvocationId;
  readonly workflowId: WorkflowId;
  readonly provider: string;
  readonly model: string;
  readonly modelRole: string;
  readonly promptVersionId: PromptVersionId;
  readonly contentSchemaVersionId?: ContentSchemaVersionId;
  readonly requestHash: string;
  readonly providerRequestId?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly latencyMs?: number;
  readonly finishReason?: string;
  readonly validationStatus: InvocationValidationStatus;
  readonly errorCode?: string;
  readonly createdAt: InstantMs;
}

export interface AIInvocationRepository {
  append(invocation: AIInvocation, context: TransactionContext): Promise<void>;
  updateResult(
    invocationId: AiInvocationId,
    result: Pick<AIInvocation, 'providerRequestId' | 'inputTokens' | 'outputTokens' | 'latencyMs' | 'finishReason'>,
    context: TransactionContext
  ): Promise<void>;
  updateValidation(
    invocationId: AiInvocationId,
    status: InvocationValidationStatus,
    errorCode: string | undefined,
    context: TransactionContext
  ): Promise<void>;
  listByWorkflow(workflowId: WorkflowId): Promise<readonly AIInvocation[]>;
}
