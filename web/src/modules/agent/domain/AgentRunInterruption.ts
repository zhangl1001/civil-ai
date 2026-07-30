export class AgentRunSuspendedError extends Error {
  readonly code = 'agent_run.lifecycle_suspended';

  constructor(message = 'Agent execution suspended because the app left the foreground.') {
    super(message);
    this.name = 'AgentRunSuspendedError';
  }
}

export class AgentRunLeaseLostError extends Error {
  readonly code = 'agent_run.lease_lost';

  constructor(runId: string) {
    super(`Agent run lease lost: ${runId}`);
    this.name = 'AgentRunLeaseLostError';
  }
}

export function isAgentRunSuspended(error: unknown): error is AgentRunSuspendedError {
  return error instanceof AgentRunSuspendedError
    || (
      Boolean(error)
      && typeof error === 'object'
      && (error as { readonly code?: unknown }).code === 'agent_run.lifecycle_suspended'
    );
}

export function isAgentRunLeaseLost(error: unknown): error is AgentRunLeaseLostError {
  return error instanceof AgentRunLeaseLostError
    || (
      Boolean(error)
      && typeof error === 'object'
      && (error as { readonly code?: unknown }).code === 'agent_run.lease_lost'
    );
}
