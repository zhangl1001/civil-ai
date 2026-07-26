import type { AgentRunId } from '@/kernel/public';
import { AgentRunAction } from '../domain/AgentRunCodes';
import type { TutorAgentLifecycleObserver } from './RunTutorAgentBatch';
import { AgentRunExecutionRegistry } from './AgentRunExecutionRegistry';
import { TransitionAgentRun } from './TransitionAgentRun';

export class CancelAgentRun {
  constructor(
    private readonly transition: TransitionAgentRun,
    private readonly executions?: AgentRunExecutionRegistry,
    private readonly lifecycle?: TutorAgentLifecycleObserver
  ) {}

  async execute(command: { readonly agentRunId: AgentRunId; readonly reason?: string }) {
    const reason = command.reason?.trim() || 'user_cancelled';
    this.executions?.cancel(command.agentRunId);
    const cancelled = await this.transition.execute({
      idempotencyKey: `agent-run:${command.agentRunId}:cancel:${reason}`,
      agentRunId: command.agentRunId,
      action: AgentRunAction.Cancel,
      reasonCode: reason,
      cancellationReason: reason
    });
    await this.lifecycle?.cancelled(cancelled, reason);
    return cancelled;
  }
}
