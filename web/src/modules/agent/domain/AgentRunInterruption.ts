export class AgentRunSuspendedError extends Error {
  readonly code = 'agent_run.lifecycle_suspended';

  constructor(message = 'Agent execution suspended because the app left the foreground.') {
    super(message);
    this.name = 'AgentRunSuspendedError';
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
