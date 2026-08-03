import type { ModelMessage, ProviderGateway } from '@/capabilities/ai-runtime/public';
import type { AgentRunId } from '@/kernel/public';
import type {
  AgentLoopCheckpoint,
  AgentToolExecutionContext
} from '../contracts/AgentRuntimePorts';
import type { AgentSkillActivation } from '../domain/AgentSkillRegistry';
import type { AgentToolDefinition } from '../domain/AgentToolRegistry';

export interface RunAgentLoopCommand {
  readonly agentRunId: AgentRunId;
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly AgentToolDefinition[];
  readonly availableTools?: readonly AgentToolDefinition[];
  readonly skills?: readonly AgentSkillActivation[];
  readonly executionContext: AgentToolExecutionContext;
  readonly checkpoint?: AgentLoopCheckpoint;
  readonly maxTurns?: number;
  readonly maxToolCalls?: number;
  readonly maxToolCallsPerTurn?: number;
  readonly maxParallelReadToolCalls?: number;
  readonly maxToolResultChars?: number;
  readonly maxWallTimeMs?: number;
  readonly maxContextTokens?: number;
  readonly confirmationDecision?: 'confirm' | 'reject';
  readonly preferStream?: boolean;
  readonly requiredToolName?: string;
  readonly forceRequiredToolOnFirstTurn?: boolean;
  readonly consumeGuidance?: () => readonly ModelMessage[] | Promise<readonly ModelMessage[]>;
}

export interface AgentLoopResult {
  readonly status: 'completed' | 'delegated' | 'waiting_user' | 'budget_exhausted';
  readonly text: string;
  readonly checkpoint: AgentLoopCheckpoint;
}

/** Stable application boundary for interchangeable Agent loop engines. */
export interface AgentLoopRuntime {
  execute(
    command: RunAgentLoopCommand,
    gateway: ProviderGateway,
    signal?: AbortSignal
  ): Promise<AgentLoopResult>;
}
