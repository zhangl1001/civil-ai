import type { AgentRunId, InstantMs } from '@/kernel/public';

export const AgentToolReceiptStatus = {
  Prepared: 'prepared',
  Running: 'running',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Unknown: 'unknown'
} as const;

export type AgentToolReceiptStatus =
  typeof AgentToolReceiptStatus[keyof typeof AgentToolReceiptStatus];

export interface AgentToolReceipt {
  readonly agentRunId: AgentRunId;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argumentsHash: string;
  readonly businessIdempotencyKey: string;
  readonly status: AgentToolReceiptStatus;
  readonly resultJson?: string;
  readonly resultRef?: string;
  readonly failureCode?: string;
  readonly retryable: boolean;
  readonly attemptCount: number;
  readonly leaseEpoch: number;
  readonly createdAt: InstantMs;
  readonly updatedAt: InstantMs;
  readonly completedAt?: InstantMs;
  readonly version: number;
}

export interface AgentToolReceiptRepository {
  claim(receipt: AgentToolReceipt): Promise<AgentToolReceipt>;
  replace(receipt: AgentToolReceipt, expectedVersion: number): Promise<void>;
}
