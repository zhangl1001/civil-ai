import { RegisteredAgentToolExecutor } from '@/modules/agent/public';
import { compileChatAgentSkills, CHAT_AGENT_SKILL_SELECTOR_TOOL } from './ChatAgentCapabilities';

/** Registers the catalog-only selector; selected skills expose concrete tools next turn. */
export function registerChatAgentSkillSelector(executor: RegisteredAgentToolExecutor): void {
  executor.register(CHAT_AGENT_SKILL_SELECTOR_TOOL, async (call) => {
    const skillNames = Array.isArray(call.arguments.skillNames)
      ? call.arguments.skillNames.map((value) => String(value))
      : [];
    const bundle = compileChatAgentSkills(skillNames);
    return {
      content: JSON.stringify({
        loadedSkills: bundle.skillNames,
        availableToolCount: bundle.tools.length,
        nextAction: 'continue_with_operational_tool_or_request_missing_input'
      }),
      activateToolNames: bundle.tools.map((tool) => tool.name),
      activateSkills: bundle.activations
    };
  });
}
