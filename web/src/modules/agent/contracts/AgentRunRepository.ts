import type { TransactionContext } from '@/capabilities/database/public';
import type { AiInvocationId, AgentRunId, ExamCycleId, InstantMs, JsonObject, LearningThreadId, PromptVersionId } from '@/kernel/public';
import type { InvocationValidationStatus } from '@/capabilities/ai-runtime/public';
import type {
  AgentExecutionClass,
  AgentRunStatus,
  AgentRunType,
  AgentWorkPool
} from '../domain/AgentRunCodes';

export interface AgentRunRecord {
  readonly id: AgentRunId;
  readonly runType: AgentRunType;
  readonly workPool?: AgentWorkPool;
  readonly executionClass?: AgentExecutionClass;
  readonly status: AgentRunStatus;
  readonly examCycleId?: ExamCycleId;
  readonly learningThreadId?: LearningThreadId;
  readonly targetResourceType?: string;
  readonly targetResourceId?: string;
  readonly inputSnapshot: JsonObject;
  readonly checkpoint: JsonObject;
  readonly attemptCount: number;
  readonly nextRunAt?: InstantMs;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: InstantMs;
  readonly errorCode?: string;
  readonly cancellationReason?: string;
  readonly idempotencyKey: string;
  readonly createdAt: InstantMs;
  readonly updatedAt: InstantMs;
  readonly completedAt?: InstantMs;
  readonly version: number;
}

export interface AgentRunEventRecord {
  readonly id: string;
  readonly agentRunId: AgentRunId;
  readonly eventType: 'created' | 'started' | 'progressed' | 'waiting_user' | 'resumed' | 'recovered' | 'completed' | 'failed' | 'cancelled';
  readonly fromStatus?: AgentRunStatus;
  readonly toStatus: AgentRunStatus;
  readonly reasonCode: string;
  readonly payload: JsonObject;
  readonly occurredAt: InstantMs;
  readonly idempotencyKey: string;
}

export interface AgentInvocationRecord {
  readonly id: AiInvocationId;
  readonly agentRunId: AgentRunId;
  readonly provider: string;
  readonly model: string;
  readonly modelRole: string;
  readonly promptVersionId?: PromptVersionId;
  readonly toolSchemaVersion?: string;
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

export interface AgentRunAggregate {
  readonly run: AgentRunRecord;
  readonly events: readonly AgentRunEventRecord[];
}

export interface AgentRunRepository {
  create(run: AgentRunRecord, created: AgentRunEventRecord, context: TransactionContext): Promise<void>;
  findById(runId: AgentRunId): Promise<AgentRunAggregate | undefined>;
  findByIdempotencyKey(idempotencyKey: string): Promise<AgentRunAggregate | undefined>;
  findLatestByTarget(targetResourceType: string, targetResourceId: string): Promise<AgentRunAggregate | undefined>;
  findActiveByTarget(targetResourceType: string, targetResourceId: string): Promise<AgentRunAggregate | undefined>;
  replace(run: AgentRunRecord, expectedVersion: number, event: AgentRunEventRecord, context: TransactionContext): Promise<void>;
  appendInvocation(invocation: AgentInvocationRecord, context: TransactionContext): Promise<void>;
  updateInvocationResult(id: AiInvocationId, result: Pick<AgentInvocationRecord, 'providerRequestId' | 'inputTokens' | 'outputTokens' | 'latencyMs' | 'finishReason'>, context: TransactionContext): Promise<void>;
  updateInvocationValidation(id: AiInvocationId, status: InvocationValidationStatus, errorCode: string | undefined, context: TransactionContext): Promise<void>;
  listInvocations(runId: AgentRunId): Promise<readonly AgentInvocationRecord[]>;
  countInvocations(runIds: readonly AgentRunId[]): Promise<Readonly<Record<string, number>>>;
  listRecent(limit: number): Promise<readonly AgentRunAggregate[]>;
  listRunnable(now: InstantMs, limit: number): Promise<readonly AgentRunAggregate[]>;
  nextWorkAt(
    now: InstantMs,
    workPools?: readonly AgentWorkPool[],
    executionClasses?: readonly AgentExecutionClass[]
  ): Promise<InstantMs | undefined>;
  claimRunnable(options: AgentRunClaimOptions): Promise<readonly AgentRunAggregate[]>;
  renewLease(runId: AgentRunId, workerId: string, leaseExpiresAt: InstantMs): Promise<boolean>;
  recoverExpiredLeases(options: AgentRunRecoveryOptions): Promise<readonly AgentRunAggregate[]>;
}

export interface AgentRunRecoveryOptions {
  readonly now: InstantMs;
  readonly limit: number;
  readonly eventIds: readonly string[];
}

export interface AgentRunClaimOptions {
  readonly workerId: string;
  readonly now: InstantMs;
  readonly leaseExpiresAt: InstantMs;
  readonly limit: number;
  readonly eventIds: readonly string[];
  readonly workPools?: readonly AgentWorkPool[];
  readonly executionClasses?: readonly AgentExecutionClass[];
}
