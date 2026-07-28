/** Exact context supplied by a first-party workflow, never inferred from user prose. */
export interface AgentWorkflowInvocation {
  readonly skillCodes?: readonly string[];
  readonly systemConstraint?: string;
}
