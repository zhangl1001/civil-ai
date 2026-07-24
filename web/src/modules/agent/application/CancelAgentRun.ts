import type { AgentRunId } from '@/kernel/public';
import { AgentRunAction } from '../domain/AgentRunCodes';
import { TransitionAgentRun } from './TransitionAgentRun';

export class CancelAgentRun {
  constructor(private readonly transition: TransitionAgentRun) {}

  execute(command: { readonly agentRunId: AgentRunId; readonly reason?: string }) {
    const reason = command.reason?.trim() || 'user_cancelled';
    return this.transition.execute({
      idempotencyKey: `agent-run:${command.agentRunId}:cancel:${reason}`,
      agentRunId: command.agentRunId,
      action: AgentRunAction.Cancel,
      reasonCode: reason,
      cancellationReason: reason
    });
  }
}
