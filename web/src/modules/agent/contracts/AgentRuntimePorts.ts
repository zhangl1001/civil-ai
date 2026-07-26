import type {
  ModelMessage,
  ModelToolCall,
  ProviderGateway,
  ProviderResponse,
  ProviderToolDefinition
} from '@/capabilities/ai-runtime/public';
import type { AgentRunId, InstantMs, JsonObject } from '@/kernel/public';
import type { AgentToolDefinition } from '../domain/AgentToolRegistry';

export const AgentMemoryLayer = {
  Working: 'working',
  Session: 'session',
  Episodic: 'episodic',
  Semantic: 'semantic',
  Prospective: 'prospective'
} as const;

export type AgentMemoryLayer = typeof AgentMemoryLayer[keyof typeof AgentMemoryLayer];

export interface AgentMemoryRecord {
  readonly id: string;
  readonly examCycleId?: string;
  readonly sessionId?: string;
  readonly learningThreadId?: string;
  readonly layer: AgentMemoryLayer;
  readonly memoryCode: string;
  readonly content: JsonObject;
  readonly sourceRef?: string;
  readonly confidence?: number;
  readonly validFrom: InstantMs;
  readonly expiresAt?: InstantMs;
  readonly supersededBy?: string;
}

export interface AgentMemoryQuery {
  readonly examCycleId?: string;
  readonly sessionId?: string;
  readonly learningThreadId?: string;
  readonly layers: readonly AgentMemoryLayer[];
  readonly memoryCodes?: readonly string[];
  readonly limit: number;
  readonly now: InstantMs;
}

export interface AgentMemoryRepository {
  recall(query: AgentMemoryQuery): Promise<readonly AgentMemoryRecord[]>;
  append(record: AgentMemoryRecord): Promise<void>;
  supersede(memoryId: string, replacementId: string): Promise<void>;
  forgetSession(sessionId: string): Promise<void>;
}

export interface AgentContextSection {
  readonly code: string;
  readonly content: string;
  readonly priority: number;
  readonly required: boolean;
  readonly maxTokens: number;
}

export interface CompiledAgentContext {
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ProviderToolDefinition[];
  readonly contextCodes: readonly string[];
  readonly estimatedTokens: number;
}

export interface AgentContextRequest {
  readonly agentRunId: AgentRunId;
  readonly audience: string;
  readonly goal: string;
  readonly skillCodes: readonly string[];
  readonly input: JsonObject;
  readonly history: readonly ModelMessage[];
  readonly tokenBudget: number;
}

export interface AgentContextCompiler {
  compile(request: AgentContextRequest): Promise<CompiledAgentContext>;
}

export const AgentToolPolicyDecision = {
  Allow: 'allow',
  Confirm: 'confirm',
  Reject: 'reject'
} as const;

export type AgentToolPolicyDecision = typeof AgentToolPolicyDecision[keyof typeof AgentToolPolicyDecision];

export interface AgentToolPolicyResult {
  readonly decision: AgentToolPolicyDecision;
  readonly reasonCode: string;
}

export interface AgentToolExecutionContext {
  readonly agentRunId: AgentRunId;
  readonly examCycleId?: string;
  readonly learningThreadId?: string;
  readonly sessionId?: string;
  readonly signal?: AbortSignal;
}

export interface AgentToolExecutionResult {
  readonly content: string;
  readonly resultRef?: string;
  readonly isError?: boolean;
}

export interface AgentToolPolicy {
  evaluate(
    definition: AgentToolDefinition,
    call: ModelToolCall,
    context: AgentToolExecutionContext
  ): Promise<AgentToolPolicyResult>;
}

export interface AgentToolExecutor {
  execute(
    definition: AgentToolDefinition,
    call: ModelToolCall,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult>;
}

export interface AgentCheckpointStore {
  save(checkpoint: AgentLoopCheckpoint): Promise<void>;
}

export interface AgentModelInvocation {
  readonly agentRunId: AgentRunId;
  readonly modelRole: string;
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ProviderToolDefinition[];
  readonly toolChoice: 'auto' | 'none' | 'required' | { readonly name: string };
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly toolSchemaVersion?: string;
  readonly preferStream?: boolean;
  readonly onDelta?: (text: string) => void | Promise<void>;
}

export interface AgentModelInvoker {
  invoke(
    invocation: AgentModelInvocation,
    gateway: ProviderGateway,
    signal?: AbortSignal
  ): Promise<ProviderResponse>;
}

export interface AgentLoopCheckpoint {
  readonly agentRunId: AgentRunId;
  readonly turnCount: number;
  readonly toolCallCount: number;
  readonly messages: readonly ModelMessage[];
  readonly toolSignatures: Readonly<Record<string, number>>;
  readonly pendingConfirmation?: ModelToolCall;
}

export type AgentRuntimeEvent =
  | { readonly type: 'run_started'; readonly agentRunId: AgentRunId }
  | { readonly type: 'model_turn_started'; readonly agentRunId: AgentRunId; readonly turn: number }
  | { readonly type: 'text_delta'; readonly agentRunId: AgentRunId; readonly text: string }
  | { readonly type: 'tool_call_requested'; readonly agentRunId: AgentRunId; readonly call: ModelToolCall }
  | { readonly type: 'tool_call_started'; readonly agentRunId: AgentRunId; readonly call: ModelToolCall }
  | { readonly type: 'tool_call_succeeded'; readonly agentRunId: AgentRunId; readonly call: ModelToolCall; readonly resultRef?: string }
  | { readonly type: 'tool_call_failed'; readonly agentRunId: AgentRunId; readonly call: ModelToolCall; readonly reasonCode: string }
  | { readonly type: 'confirmation_required'; readonly agentRunId: AgentRunId; readonly call: ModelToolCall; readonly reasonCode: string }
  | { readonly type: 'checkpoint_saved'; readonly agentRunId: AgentRunId; readonly turn: number }
  | { readonly type: 'run_completed'; readonly agentRunId: AgentRunId; readonly text: string }
  | { readonly type: 'run_stopped'; readonly agentRunId: AgentRunId; readonly reasonCode: string };

export interface AgentRuntimeObserver {
  onEvent(event: AgentRuntimeEvent): Promise<void> | void;
}
