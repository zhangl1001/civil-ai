import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId, InstantMs, JsonObject } from '@/kernel/public';
import type { ProactiveSignalStatus, ProactiveSignalType } from '../domain/ProactiveSignalCodes';

export interface ProactiveSignal {
  readonly id: string;
  readonly examCycleId: ExamCycleId;
  readonly signalType: ProactiveSignalType;
  readonly status: ProactiveSignalStatus;
  readonly priority: number;
  readonly title: string;
  readonly content: string;
  readonly evidence: JsonObject;
  readonly actionRoute?: string;
  readonly actionParams: JsonObject;
  readonly dedupKey: string;
  readonly availableAt: InstantMs;
  readonly expiresAt?: InstantMs;
  readonly deliveredAt?: InstantMs;
  readonly actedAt?: InstantMs;
  readonly dismissedAt?: InstantMs;
  readonly createdAt: InstantMs;
}

export interface ProactiveSignalRepository {
  append(signal: ProactiveSignal, context: TransactionContext): Promise<ProactiveSignal>;
  findByDedupKey(dedupKey: string): Promise<ProactiveSignal | undefined>;
  findLatestByType(examCycleId: ExamCycleId, signalType: ProactiveSignalType): Promise<ProactiveSignal | undefined>;
  listDeliverable(examCycleId: ExamCycleId, now: InstantMs, limit: number): Promise<readonly ProactiveSignal[]>;
  transition(signalId: string, status: ProactiveSignalStatus, at: InstantMs, context: TransactionContext): Promise<ProactiveSignal | undefined>;
}
