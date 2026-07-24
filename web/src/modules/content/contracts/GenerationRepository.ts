import type { TransactionContext } from '@/capabilities/database/public';
import type { WorkflowId } from '@/kernel/public';
import type { GenerationSpecRecord, GenerationWorkflowRecord } from './ContentRepository';

export interface GenerationAggregate {
  readonly spec: GenerationSpecRecord;
  readonly workflow: GenerationWorkflowRecord;
}

export interface GenerationRepository {
  create(aggregate: GenerationAggregate, context: TransactionContext): Promise<void>;
  replaceWorkflow(
    workflow: GenerationWorkflowRecord,
    expectedVersion: number,
    context: TransactionContext
  ): Promise<void>;
  findByWorkflowId(workflowId: WorkflowId): Promise<GenerationAggregate | undefined>;
  findByIdempotencyKey(idempotencyKey: string): Promise<GenerationAggregate | undefined>;
}
