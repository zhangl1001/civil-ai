import type { ProviderToolDefinition } from '@/capabilities/ai-runtime/public';
import type { AgentRunId } from '@/kernel/public';
import {
  DefaultAgentContextCompiler,
  type CompiledAgentContext
} from '@/modules/agent/public';
import type { PreparedConversationContext } from './AgentConversationMemoryService';

const compiler = new DefaultAgentContextCompiler();

export interface CompileChatAgentContextInput {
  readonly agentRunId: AgentRunId;
  readonly system: string;
  readonly studentContext: string;
  readonly conversation: PreparedConversationContext;
  readonly tools: readonly ProviderToolDefinition[];
}

export function compileChatAgentContext(
  input: CompileChatAgentContextInput
): Promise<CompiledAgentContext> {
  return compiler.compile({
    agentRunId: input.agentRunId,
    sections: [
      section('agent.system', input.system, 'system', 1_000, true, 9_000),
      section('candidate.anchor', input.studentContext, 'data', 300, false, 1_200),
      section('conversation.memory', input.conversation.memoryContext, 'data', 200, false, 900),
      section('conversation.summary', input.conversation.sessionSummary, 'data', 100, false, 1_200)
    ],
    history: input.conversation.messages,
    tools: input.tools,
    tokenBudget: 24_000,
    outputReserveTokens: 8_192
  });
}

function section(
  code: string,
  content: string,
  trust: 'system' | 'data',
  priority: number,
  required: boolean,
  maxTokens: number
) {
  return { code, content, trust, priority, required, maxTokens };
}
