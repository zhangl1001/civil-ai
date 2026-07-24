import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb, TutorIndexedDbStore } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { WorkflowId } from '@/kernel/public';
import type { GenerationAggregate, GenerationRepository } from '../contracts/GenerationRepository';

interface StoredGenerationAggregate {
  readonly workflowId: string;
  readonly idempotencyKey: string;
  readonly aggregate: GenerationAggregate;
}

export class IndexedDbGenerationRepository implements GenerationRepository {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly transactionScope: IndexedDbTransactionScope
  ) {}

  async create(aggregate: GenerationAggregate, context: TransactionContext): Promise<void> {
    this.transactionScope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.GenerationAggregates,
      value: toStored(aggregate)
    });
  }

  async replaceWorkflow(
    workflow: GenerationAggregate['workflow'],
    expectedVersion: number,
    context: TransactionContext
  ): Promise<void> {
    const current = await this.findByWorkflowId(workflow.id);
    if (!current || current.workflow.version !== expectedVersion) {
      throw new Error(`Generation workflow version conflict: ${workflow.id}`);
    }
    if (workflow.version !== expectedVersion + 1) throw new Error('Generation workflow version must advance by one');
    this.transactionScope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.GenerationAggregates,
      value: toStored({ spec: current.spec, workflow })
    });
  }

  async findByWorkflowId(workflowId: WorkflowId): Promise<GenerationAggregate | undefined> {
    const stored = await this.database.get<StoredGenerationAggregate>(TutorIndexedDbStore.GenerationAggregates, workflowId);
    return stored?.aggregate;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<GenerationAggregate | undefined> {
    const records = await this.database.getAll<StoredGenerationAggregate>(TutorIndexedDbStore.GenerationAggregates);
    return records.find((record) => record.idempotencyKey === idempotencyKey)?.aggregate;
  }
}

function toStored(aggregate: GenerationAggregate): StoredGenerationAggregate {
  return {
    workflowId: aggregate.workflow.id,
    idempotencyKey: aggregate.workflow.idempotencyKey,
    aggregate
  };
}
