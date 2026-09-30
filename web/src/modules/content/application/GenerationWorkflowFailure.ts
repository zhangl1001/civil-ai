import {
  InvocationValidationStatus,
  ProviderGatewayError,
  type AIInvocationRepository
} from '@/capabilities/ai-runtime/public';
import type { UnitOfWork } from '@/capabilities/database/public';
import { SiblingTaskFailedError, type Clock } from '@/kernel/public';
import { isAgentRunLeaseLost, isAgentRunSuspended } from '@/modules/agent/public';
import type { GenerationWorkflowRecord } from '../contracts/ContentRepository';
import type { GenerationRepository } from '../contracts/GenerationRepository';
import { GenerationWorkflowStatus } from '../domain/ContentCodes';
import { GenerationWorkflowMachine } from '../domain/GenerationWorkflowMachine';
import { GeneratedContentParseError } from './GeneratedContentParser';

/** The last checkpoint written by this execution, never a newer worker's state. */
export interface GenerationExecutionCheckpoint {
  workflow: GenerationWorkflowRecord;
  readonly signal: AbortSignal;
}

export function isTerminalGeneration(workflow: GenerationWorkflowRecord): boolean {
  return workflow.status === GenerationWorkflowStatus.Committed
    || workflow.status === GenerationWorkflowStatus.Failed
    || workflow.status === GenerationWorkflowStatus.Cancelled;
}

function isRecoverableInterruption(error: unknown): boolean {
  return isAgentRunLeaseLost(error) || isAgentRunSuspended(error) || error === 'agent_run.replaced';
}

export function generationFailureCode(error: unknown, signal?: AbortSignal): string {
  const reason = signal?.aborted ? signal.reason : error;
  if (isRecoverableInterruption(reason)) return 'generation.process_interrupted';
  if (reason instanceof SiblingTaskFailedError) return 'generation.sibling_failed';
  if (reason instanceof ProviderGatewayError) return `provider.${reason.kind}`;
  if (signal?.aborted) return 'generation.cancelled';
  if (error instanceof Error && error.name === 'AbortError') return 'generation.process_interrupted';
  if (error instanceof GeneratedContentParseError) return error.code;
  return 'generation.unexpected_failure';
}

/** Failure cleanup may only terminate the checkpoint this execution owns. */
export class GenerationWorkflowFailureRecorder {
  private readonly machine = new GenerationWorkflowMachine();

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly generations: GenerationRepository,
    private readonly invocations: AIInvocationRepository,
    private readonly clock: Clock
  ) {}

  async record(workflow: GenerationWorkflowRecord, error: unknown, signal?: AbortSignal): Promise<void> {
    const interrupted = () => isRecoverableInterruption(error)
      || (signal?.aborted === true && isRecoverableInterruption(signal.reason));
    // Preserve the active checkpoint on suspension/lease loss. In particular,
    // never read the latest workflow and cancel a new lease's active attempt.
    if (interrupted()) return;
    // These read ports have no transaction context. SQLite reads must finish
    // before acquiring the write transaction, otherwise they wait on its lock.
    const current = await this.generations.findByWorkflowId(workflow.id);
    if (!current || current.workflow.version !== workflow.version || isTerminalGeneration(current.workflow)) return;
    const pending = (await this.invocations.listByWorkflow(workflow.id))
      .filter((item) => item.validationStatus === InvocationValidationStatus.Pending);
    await this.unitOfWork.run(async (context) => {
      if (interrupted()) return;
      const code = generationFailureCode(error, signal);
      const cancelled = code === 'generation.cancelled';
      const terminal = cancelled
        ? this.machine.cancel(workflow, this.clock.now())
        : this.machine.fail(workflow, code, this.clock.now());
      // A newer attempt between the reads and commit rejects this whole batch.
      await this.generations.replaceWorkflow(terminal, workflow.version, context);
      for (const invocation of pending) {
        await this.invocations.updateValidation(invocation.id,
          cancelled ? InvocationValidationStatus.Cancelled : InvocationValidationStatus.Invalid, code, context);
      }
      if (interrupted()) throw signal?.reason ?? error;
    });
  }
}
