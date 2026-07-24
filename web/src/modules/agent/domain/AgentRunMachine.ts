import type { Clock, InstantMs, JsonObject } from '@/kernel/public';
import type { AgentRunRecord } from '../contracts/AgentRunRepository';
import { AgentRunAction, AgentRunStatus } from './AgentRunCodes';

export class AgentRunMachine {
  transition(
    run: AgentRunRecord,
    action: AgentRunAction,
    clock: Clock,
    options: { readonly checkpoint?: JsonObject; readonly errorCode?: string; readonly cancellationReason?: string; readonly nextRunAt?: InstantMs } = {}
  ): AgentRunRecord {
    if (!isAllowed(run.status, action)) throw new Error(`Agent run transition is not allowed: ${run.status} -> ${action}`);
    const now = clock.now();
    const status = statusFor(action);
    return {
      ...run,
      status,
      checkpoint: options.checkpoint ?? run.checkpoint,
      attemptCount: action === AgentRunAction.Start || action === AgentRunAction.Resume ? run.attemptCount + 1 : run.attemptCount,
      nextRunAt: status === AgentRunStatus.Queued ? options.nextRunAt : undefined,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      errorCode: action === AgentRunAction.Fail || action === AgentRunAction.Retry ? requireText(options.errorCode, 'Agent run failure requires an error code') : undefined,
      cancellationReason: action === AgentRunAction.Cancel ? requireText(options.cancellationReason, 'Agent run cancellation requires a reason') : undefined,
      completedAt: isTerminal(status) ? now : undefined,
      updatedAt: now,
      version: run.version + 1
    };
  }
}

function isAllowed(status: AgentRunStatus, action: AgentRunAction): boolean {
  if (status === AgentRunStatus.Queued) return action === AgentRunAction.Start || action === AgentRunAction.Cancel;
  if (status === AgentRunStatus.Running) {
    return action === AgentRunAction.WaitForUser || action === AgentRunAction.Complete
      || action === AgentRunAction.Fail || action === AgentRunAction.Retry || action === AgentRunAction.Cancel;
  }
  if (status === AgentRunStatus.WaitingUser) return action === AgentRunAction.Resume || action === AgentRunAction.Cancel;
  return false;
}
function statusFor(action: AgentRunAction): AgentRunStatus {
  if (action === AgentRunAction.Start || action === AgentRunAction.Resume) return AgentRunStatus.Running;
  if (action === AgentRunAction.Retry) return AgentRunStatus.Queued;
  if (action === AgentRunAction.WaitForUser) return AgentRunStatus.WaitingUser;
  if (action === AgentRunAction.Complete) return AgentRunStatus.Completed;
  if (action === AgentRunAction.Fail) return AgentRunStatus.Failed;
  return AgentRunStatus.Cancelled;
}
function isTerminal(status: AgentRunStatus): boolean {
  return status === AgentRunStatus.Completed || status === AgentRunStatus.Failed || status === AgentRunStatus.Cancelled;
}
function requireText(value: string | undefined, message: string): string {
  if (!value?.trim()) throw new Error(message);
  return value.trim();
}
