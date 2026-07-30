import {
  TutorIndexedDb,
  TutorIndexedDbStore
} from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type {
  AgentToolReceipt,
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

  async replace(receipt: AgentToolReceipt, expectedVersion: number): Promise<void> {
    await this.database.mutateStore<AgentToolReceipt, void>(
      TutorIndexedDbStore.AgentToolReceipts,
      (values) => {
        const current = values.find((item) => (
          item.agentRunId === receipt.agentRunId && item.toolCallId === receipt.toolCallId
        ));
        if (!current || current.version !== expectedVersion) {
          throw new Error('Agent tool receipt transition conflict');
        }
        if (
          current.toolName !== receipt.toolName
          || current.argumentsHash !== receipt.argumentsHash
        ) {
          throw new Error('Agent tool receipt identity conflict');
        }
        return {
          operations: [{
            type: 'put',
            store: TutorIndexedDbStore.AgentToolReceipts,
            value: receipt
          }],
          result: undefined
        };
      }
    );
  }
}
