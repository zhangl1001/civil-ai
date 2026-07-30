import {
  AgentRunStatus,
  type AgentCompletionVerification
} from '@/modules/agent/public';

export function agentRunCompletionExpectation(taskId?: string): {
  readonly completionExpectation?: {
    readonly resourceType: 'agent_run';
    readonly resourceId: string;
    readonly expectedTerminalState: typeof AgentRunStatus.Completed;
  };
} {
  return taskId
    ? {
        completionExpectation: {
          resourceType: 'agent_run',
          resourceId: taskId,
          expectedTerminalState: AgentRunStatus.Completed
        }
      }
    : {};
}

export function agentRunCompletionVerification(
  result: Readonly<Record<string, unknown>>,
  requestedTaskId?: string
): AgentCompletionVerification | undefined {
  if (!requestedTaskId) return undefined;
  if (result.found !== true) {
    return {
      resourceType: 'agent_run',
      resourceId: requestedTaskId,
      state: 'not_found',
      terminal: false
    };
  }
  const task = recordValue(result.task);
  const taskId = stringValue(task?.taskId);
  const state = stringValue(task?.status);
  if (taskId !== requestedTaskId || !state) return undefined;
  return {
    resourceType: 'agent_run',
    resourceId: taskId,
    state,
    terminal: state === AgentRunStatus.Completed
      || state === AgentRunStatus.Failed
      || state === AgentRunStatus.Cancelled
  };
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
