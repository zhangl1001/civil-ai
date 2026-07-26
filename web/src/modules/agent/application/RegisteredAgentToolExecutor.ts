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

  register(toolCode: string, handler: AgentToolHandler): void {
    if (!toolCode.trim()) throw new Error('Agent tool handler requires a code');
    if (this.handlers.has(toolCode)) throw new Error(`Duplicate Agent tool handler: ${toolCode}`);
    this.handlers.set(toolCode, handler);
  }

  async execute(
    definition: AgentToolDefinition,
    call: ModelToolCall,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    if (definition.code !== call.name) throw new Error(`Agent tool definition mismatch: ${call.name}`);
    const handler = this.handlers.get(definition.code);
    if (!handler) throw new Error(`Agent tool executor is unavailable: ${definition.code}`);
    return handler(call, context);
  }
}
