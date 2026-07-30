import type { Clock } from '@/kernel/public';
import type {
  ModelToolCall
} from '@/capabilities/ai-runtime/public';
import type {
  AgentToolExecutionContext,
  AgentToolExecutionResult,
  AgentToolExecutor
} from '../contracts/AgentRuntimePorts';
import {
  AgentToolReceiptStatus,
  type AgentToolReceipt,
  type AgentToolReceiptRepository
} from '../contracts/AgentToolReceiptRepository';
import { AgentToolRisk, type AgentToolDefinition } from '../domain/AgentToolRegistry';
import { AgentToolInvocationValidator } from './AgentToolInvocationValidator';
import { agentToolArgumentsHash } from './AgentToolCallIdentity';

const activeWriteCalls = new Set<string>();
const MAX_RECEIPT_CONTENT_CHARS = 120_000;

/** Adds durable replay protection to write tools while leaving read tools ephemeral. */
export class DurableAgentToolExecutor implements AgentToolExecutor {
  constructor(
    private readonly executor: AgentToolExecutor,
    private readonly receipts: AgentToolReceiptRepository,
    private readonly clock: Clock,
    private readonly validator = new AgentToolInvocationValidator()
  ) {}

  async execute(
    definition: AgentToolDefinition,
    call: ModelToolCall,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    const validation = this.validator.validate(definition, call);
    if (!validation.valid) {
      throw new Error(`Agent tool arguments are invalid: ${validation.errors.join('; ')}`);
    }
    if (definition.risk === AgentToolRisk.Read) {
      return this.executor.execute(definition, call, context);
    }

    const key = `${context.agentRunId}:${call.id}`;
    if (activeWriteCalls.has(key)) {
      throw new Error(`Agent write tool is already running: ${definition.name}`);
    }

    const argumentsHash = agentToolArgumentsHash(call);
    const businessIdempotencyKey = `agent-tool:${context.agentRunId}:${call.id}`;
    const now = this.clock.now();
    const claimed = await this.receipts.claim({
      agentRunId: context.agentRunId,
      toolCallId: call.id,
      toolName: definition.name,
      argumentsHash,
      businessIdempotencyKey,
      status: AgentToolReceiptStatus.Prepared,
      retryable: true,
      attemptCount: 0,
      leaseEpoch: context.leaseToken?.leaseEpoch ?? 0,
      createdAt: now,
      updatedAt: now,
      version: 0
    });
    assertSameInvocation(claimed, definition, argumentsHash);

    const replay = replayResult(claimed);
    if (replay) return replay;

    const recoverable = claimed.status === AgentToolReceiptStatus.Running
      ? await this.markUnknown(claimed)
      : claimed;
    const running = transitionReceipt(recoverable, {
      status: AgentToolReceiptStatus.Running,
      retryable: true,
      attemptCount: recoverable.attemptCount + 1,
      leaseEpoch: context.leaseToken?.leaseEpoch ?? recoverable.leaseEpoch,
      updatedAt: this.clock.now(),
      completedAt: undefined,
      failureCode: undefined
    });
    await this.receipts.replace(running, recoverable.version);

    activeWriteCalls.add(key);
    try {
      const result = await this.executor.execute(definition, call, {
        ...context,
        businessIdempotencyKey
      });
      const completedAt = this.clock.now();
      const status = result.isError
        ? AgentToolReceiptStatus.Failed
        : AgentToolReceiptStatus.Succeeded;
      await this.receipts.replace(transitionReceipt(running, {
        status,
        resultJson: serializeResult(result),
        resultRef: result.resultRef,
        failureCode: result.failureCode,
        retryable: result.retryable !== false,
        updatedAt: completedAt,
        completedAt
      }), running.version);
      return result;
    } catch (error) {
      const completedAt = this.clock.now();
      await this.receipts.replace(transitionReceipt(running, {
        status: AgentToolReceiptStatus.Failed,
        failureCode: 'agent.tool_execution_failed',
        retryable: true,
        updatedAt: completedAt,
        completedAt
      }), running.version).catch(() => undefined);
      throw error;
    } finally {
      activeWriteCalls.delete(key);
    }
  }

  private async markUnknown(receipt: AgentToolReceipt): Promise<AgentToolReceipt> {
    const unknown = transitionReceipt(receipt, {
      status: AgentToolReceiptStatus.Unknown,
      failureCode: 'agent.tool_outcome_unknown',
      retryable: true,
      updatedAt: this.clock.now(),
      completedAt: undefined
    });
    await this.receipts.replace(unknown, receipt.version);
    return unknown;
  }
}

function assertSameInvocation(
  receipt: AgentToolReceipt,
  definition: AgentToolDefinition,
  argumentsHash: string
): void {
  if (receipt.toolName !== definition.name || receipt.argumentsHash !== argumentsHash) {
    throw new Error(`Agent tool call identity conflict: ${definition.name}`);
  }
}

function replayResult(receipt: AgentToolReceipt): AgentToolExecutionResult | undefined {
  const replayable = receipt.status === AgentToolReceiptStatus.Succeeded
    || (receipt.status === AgentToolReceiptStatus.Failed && !receipt.retryable);
  if (!replayable || !receipt.resultJson) return undefined;
  const value = JSON.parse(receipt.resultJson) as AgentToolExecutionResult;
  return value;
}

function transitionReceipt(
  current: AgentToolReceipt,
  changes: Partial<AgentToolReceipt>
): AgentToolReceipt {
  return {
    ...current,
    ...changes,
    version: current.version + 1
  };
}

function serializeResult(result: AgentToolExecutionResult): string {
  return JSON.stringify({
    ...result,
    content: result.content.slice(0, MAX_RECEIPT_CONTENT_CHARS)
  });
}
