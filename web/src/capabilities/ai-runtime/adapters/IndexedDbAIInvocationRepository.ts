import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb, TutorIndexedDbStore } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { AiInvocationId, WorkflowId } from '@/kernel/public';
import type { AIInvocation, AIInvocationRepository, InvocationValidationStatus } from '../contracts/AIInvocationRepository';

interface StoredInvocation extends AIInvocation {
  readonly workflowKey: string;
}

export class IndexedDbAIInvocationRepository implements AIInvocationRepository {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly transactionScope: IndexedDbTransactionScope
  ) {}

  async append(invocation: AIInvocation, context: TransactionContext): Promise<void> {
    this.transactionScope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.AIInvocations,
      value: { ...invocation, workflowKey: invocation.workflowId } satisfies StoredInvocation
    });
  }

  async listByWorkflow(workflowId: WorkflowId): Promise<readonly AIInvocation[]> {
    const records = await this.database.getAll<StoredInvocation>(TutorIndexedDbStore.AIInvocations);
    return records
      .filter((record) => record.workflowKey === workflowId)
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  async updateResult(
    invocationId: AiInvocationId,
    result: Pick<AIInvocation, 'providerRequestId' | 'inputTokens' | 'outputTokens' | 'latencyMs' | 'finishReason'>,
    context: TransactionContext
  ): Promise<void> {
    const current = await this.database.get<StoredInvocation>(TutorIndexedDbStore.AIInvocations, invocationId);
    if (!current || current.validationStatus !== 'pending') {
      throw new Error(`AI invocation result conflict: ${invocationId}`);
    }
    this.transactionScope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.AIInvocations,
      value: { ...current, ...result }
    });
  }

  async updateValidation(
    invocationId: AiInvocationId,
    status: InvocationValidationStatus,
    errorCode: string | undefined,
    context: TransactionContext
  ): Promise<void> {
    const current = await this.database.get<StoredInvocation>(TutorIndexedDbStore.AIInvocations, invocationId);
    if (!current || current.validationStatus !== 'pending') {
      throw new Error(`AI invocation validation conflict: ${invocationId}`);
    }
    this.transactionScope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.AIInvocations,
      value: { ...current, validationStatus: status, errorCode }
    });
  }
}
