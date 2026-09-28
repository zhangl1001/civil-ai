import type { ModelMessage, ModelToolCall } from '@/capabilities/ai-runtime/public';
import type { AgentRunId } from '@/kernel/public';
import type {
  AgentLoopCheckpoint,
  AgentSkillWorkflowState,
  AgentToolAttemptState
} from '../contracts/AgentRuntimePorts';
import type { AgentSkillActivation } from '../domain/AgentSkillRegistry';
import { sanitizeMessageForCheckpoint } from './AgentLoopSupport';
import { agentToolArgumentsHash, cloneAgentToolCall } from './AgentToolCallIdentity';

/** Loop state both Agent loop engines persist after every turn. */
export interface AgentLoopCheckpointState {
  readonly pendingConfirmation?: ModelToolCall;
  readonly activeSkills: readonly AgentSkillActivation[];
  readonly activeToolNames: readonly string[];
  readonly completedToolNames: readonly string[];
  readonly skillWorkflowState: AgentSkillWorkflowState;
  readonly awaitingCompletionVerification: boolean;
  readonly pendingCompletionExpectations: AgentLoopCheckpoint['pendingCompletionExpectations'];
}

/** Builds the resumable checkpoint shared by the Pi and the stable loop. */
export function buildAgentLoopCheckpoint(input: {
  readonly agentRunId: AgentRunId;
  readonly turnCount: number;
  readonly toolCallCount: number;
  readonly messages: readonly ModelMessage[];
  readonly signatures: Readonly<Record<string, number>>;
  readonly toolAttempts: Readonly<Record<string, AgentToolAttemptState>>;
  readonly state: AgentLoopCheckpointState;
}): AgentLoopCheckpoint {
  const { state } = input;
  return {
    agentRunId: input.agentRunId,
    turnCount: input.turnCount,
    toolCallCount: input.toolCallCount,
    messages: input.messages.map(sanitizeMessageForCheckpoint),
    toolSignatures: { ...input.signatures },
    toolAttempts: { ...input.toolAttempts },
    pendingConfirmation: state.pendingConfirmation ? cloneAgentToolCall(state.pendingConfirmation) : undefined,
    pendingConfirmationArgumentsHash: state.pendingConfirmation
      ? agentToolArgumentsHash(state.pendingConfirmation)
      : undefined,
    activeSkills: state.activeSkills,
    activeToolNames: state.activeToolNames,
    completedToolNames: state.completedToolNames,
    skillWorkflowState: state.skillWorkflowState,
    awaitingCompletionVerification: state.awaitingCompletionVerification,
    pendingCompletionExpectations: state.pendingCompletionExpectations
  };
}
