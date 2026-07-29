import type { ModelToolCall } from '@/capabilities/ai-runtime/public';
import type {
  AgentToolExecutionContext,
  AgentToolExecutionResult,
  AgentToolExecutor
} from '../contracts/AgentRuntimePorts';
import type { AgentToolDefinition } from '../domain/AgentToolRegistry';

export type AgentToolHandler = (
  call: ModelToolCall,
  context: AgentToolExecutionContext
) => Promise<AgentToolExecutionResult>;

/** Executor registry owns callable handlers; tool metadata remains in AgentToolRegistry. */
export class RegisteredAgentToolExecutor implements AgentToolExecutor {
  private readonly handlers = new Map<string, AgentToolHandler>();

  register(toolName: string, handler: AgentToolHandler): void {
    if (!toolName.trim()) throw new Error('Agent tool handler requires a name');
    if (this.handlers.has(toolName)) throw new Error(`Duplicate Agent tool handler: ${toolName}`);
    this.handlers.set(toolName, handler);
  }

  async execute(
    definition: AgentToolDefinition,
    call: ModelToolCall,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    if (definition.name !== call.name) throw new Error(`Agent tool definition mismatch: ${call.name}`);
    const handler = this.handlers.get(definition.name);
    if (!handler) throw new Error(`Agent tool executor is unavailable: ${definition.name}`);
    return handler(call, context);
  }
}
