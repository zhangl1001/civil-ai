import type {
  AgentToolExecutionContext,
  AgentToolPolicy,
  AgentToolPolicyResult
} from '../contracts/AgentRuntimePorts';
import { AgentToolPolicyDecision } from '../contracts/AgentRuntimePorts';
import {
  AgentToolCostTier,
  AgentToolNetworkScope,
  AgentToolRisk,
  type AgentToolDefinition
} from '../domain/AgentToolRegistry';
import type { ModelToolCall } from '@/capabilities/ai-runtime/public';

export class DefaultAgentToolPolicy implements AgentToolPolicy {
  async evaluate(
    definition: AgentToolDefinition,
    call: ModelToolCall,
    _context: AgentToolExecutionContext
  ): Promise<AgentToolPolicyResult> {
    if ('_parseError' in call.arguments) {
      return { decision: AgentToolPolicyDecision.Reject, reasonCode: 'policy.arguments_invalid' };
    }
    if (definition.requiresConfirmation || definition.risk === AgentToolRisk.Destructive) {
      return { decision: AgentToolPolicyDecision.Confirm, reasonCode: 'policy.user_confirmation_required' };
    }
    if (
      definition.impact?.cost === AgentToolCostTier.High
      || definition.impact?.network === AgentToolNetworkScope.Broad
    ) {
      return { decision: AgentToolPolicyDecision.Confirm, reasonCode: 'policy.high_impact_confirmation_required' };
    }
    const threshold = definition.impact?.confirmAbove;
    if (threshold) {
      const value = Number(call.arguments[threshold.argument]);
      if (Number.isFinite(value) && value > threshold.value) {
        return { decision: AgentToolPolicyDecision.Confirm, reasonCode: 'policy.cost_threshold_confirmation_required' };
      }
    }
    return { decision: AgentToolPolicyDecision.Allow, reasonCode: `policy.${definition.risk}_allowed` };
  }
}
