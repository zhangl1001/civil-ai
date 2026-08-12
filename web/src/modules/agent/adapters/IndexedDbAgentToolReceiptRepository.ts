import {
  TutorIndexedDb,
  TutorIndexedDbStore
} from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type {
  AgentToolReceipt,
  AgentToolReceiptMutationGuard,
  AgentToolReceiptRepository
} from '../contracts/AgentToolReceiptRepository';

export class IndexedDbAgentToolReceiptRepository implements AgentToolReceiptRepository {
  constructor(private readonly database: TutorIndexedDb) {}

  async claim(receipt: AgentToolReceipt): Promise<AgentToolReceipt> {
    return this.database.mutateStore<AgentToolReceipt, AgentToolReceipt>(
      TutorIndexedDbStore.AgentToolReceipts,
      (values) => {
        const existing = values.find((item) => (
          item.agentRunId === receipt.agentRunId && item.toolCallId === receipt.toolCallId
        ));
        return existing
          ? { operations: [], result: existing }
          : {
              operations: [{
                type: 'add',
                store: TutorIndexedDbStore.AgentToolReceipts,
                value: receipt
              }],
              result: receipt
            };
      }
    );
  }

  async replace(
    receipt: AgentToolReceipt,
    expectedVersion: number,
    guard?: AgentToolReceiptMutationGuard
  ): Promise<void> {
    const stores = guard
      ? [TutorIndexedDbStore.AgentToolReceipts, TutorIndexedDbStore.AgentRunAggregates]
      : [TutorIndexedDbStore.AgentToolReceipts];
    await this.database.mutateStores<void>(stores, (valuesByStore) => {
      const values = valuesByStore.get(
        TutorIndexedDbStore.AgentToolReceipts
      ) as readonly AgentToolReceipt[];
      const current = values.find((item) => (
        item.agentRunId === receipt.agentRunId && item.toolCallId === receipt.toolCallId
      ));
      if (
        !current
        || current.version !== expectedVersion
        || receipt.version !== expectedVersion + 1
      ) {
        throw new Error('Agent tool receipt transition conflict');
      }
      if (
        current.toolName !== receipt.toolName
        || current.argumentsHash !== receipt.argumentsHash
        || current.businessIdempotencyKey !== receipt.businessIdempotencyKey
      ) {
        throw new Error('Agent tool receipt identity conflict');
      }
      if (guard) assertActiveLease(
        valuesByStore.get(TutorIndexedDbStore.AgentRunAggregates) || [],
        guard
      );
      return {
        operations: [{
          type: 'put',
          store: TutorIndexedDbStore.AgentToolReceipts,
          value: receipt
        }],
        result: undefined
      };
    });
  }
}

function assertActiveLease(
  values: readonly unknown[],
  guard: AgentToolReceiptMutationGuard
): void {
  const aggregate = values.find((value) => (
    isRecord(value) && value.runId === guard.leaseToken.agentRunId
  ));
  const run = isRecord(aggregate) && isRecord(aggregate.run) ? aggregate.run : undefined;
  if (
    !run
    || run.status !== 'running'
    || run.leaseOwner !== guard.leaseToken.workerId
    || run.leaseEpoch !== guard.leaseToken.leaseEpoch
    || typeof run.leaseExpiresAt !== 'number'
    || run.leaseExpiresAt <= guard.now
  ) {
    throw new Error('Agent tool receipt lease is no longer active');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
