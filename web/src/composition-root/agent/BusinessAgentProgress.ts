import {
  TaskCenterStep,
  leaseTokenOf,
  type AgentRunAggregate,
  type UpdateAgentRunProgress
} from '@/modules/agent/public';
import type { BusinessAgentExecutionContext } from './BusinessAgentContracts';

/**
 * Progress and activity lines of one business run. Executors may report from
 * parallel batches; the progress store keeps the bar monotonic per attempt, so
 * a log line (progress 0) refreshes the activity text without moving the bar.
 */
export function createBusinessProgressReporter(input: {
  readonly run: AgentRunAggregate;
  readonly signal: AbortSignal;
  readonly progress: Pick<UpdateAgentRunProgress, 'execute'>;
}): Pick<BusinessAgentExecutionContext, 'update' | 'log'> {
  const { run, signal, progress } = input;
  return {
    update: async (value, progressText = '执行中') => {
      signal.throwIfAborted();
      await progress.execute({
        agentRunId: run.run.id,
        step: stepForProgress(value),
        progress: value,
        message: progressText,
        leaseToken: leaseTokenOf(run.run)
      });
    },
    log: async (message) => {
      signal.throwIfAborted();
      await progress.execute({
        agentRunId: run.run.id,
        step: TaskCenterStep.InvokingModel,
        progress: 0,
        message: message.slice(0, 160),
        leaseToken: leaseTokenOf(run.run)
      });
    }
  };
}

function stepForProgress(progress: number) {
  if (progress < 25) return TaskCenterStep.PreparingContext;
  if (progress < 55) return TaskCenterStep.InvokingModel;
  if (progress < 80) return TaskCenterStep.ParsingResponse;
  return TaskCenterStep.CommittingResult;
}
