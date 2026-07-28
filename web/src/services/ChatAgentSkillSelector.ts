import { RegisteredAgentToolExecutor } from '@/modules/agent/public';
import { activateChatAgentSkills, CHAT_AGENT_SKILL_SELECTOR_TOOL } from './ChatAgentCapabilities';

/** Registers the catalog-only selector; selected skills expose concrete tools next turn. */
export function registerChatAgentSkillSelector(executor: RegisteredAgentToolExecutor): void {
  executor.register(CHAT_AGENT_SKILL_SELECTOR_TOOL, async (call) => {
    const skillCodes = Array.isArray(call.arguments.skillCodes)
      ? call.arguments.skillCodes.map((value) => String(value))
      : [];
    const tools = activateChatAgentSkills(skillCodes);
    return {
      content: JSON.stringify({ selectedSkills: skillCodes, activatedToolCount: tools.length }),
      activateToolCodes: tools.map((tool) => tool.code)
    };
  });
}
