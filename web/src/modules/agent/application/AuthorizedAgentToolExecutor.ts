import type { ModelToolCall } from '@/capabilities/ai-runtime/public';
import type {
  AgentToolAuthorization,
  AgentToolExecutionContext,
  AgentToolExecutionResult,
  AgentToolExecutor
} from '../contracts/AgentRuntimePorts';
import type { AgentToolDefinition } from '../domain/AgentToolRegistry';

/** Enforces resource ownership immediately before every Tool execution, including confirmed calls. */
export class AuthorizedAgentToolExecutor implements AgentToolExecutor {
  constructor(
    private readonly executor: AgentToolExecutor,
    private readonly authorization: AgentToolAuthorization
  ) {}

  async execute(
    definition: AgentToolDefinition,
    call: ModelToolCall,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    const decision = await this.authorization.authorize(definition, call, context);
    if (!decision.authorized) {
      return {
        content: decision.message ?? '当前会话无权访问该资源。',
        isError: true,
        failureCode: decision.reasonCode,
        retryable: false
      };
    }
    return this.executor.execute(definition, call, context);
  }
}
