import type { JsonObject } from '@/kernel/public';
import {
  AgentSystemPromptComposer,
  AgentToolRegistry,
  AgentToolRisk,
  ToolExposurePlanner,
  tutorSkillCatalog,
  tutorToolCatalog,
  type AgentSkillDefinition,
  type AgentToolDefinition,
  type ToolExposurePlan
} from '@/modules/agent/public';
import { AI_BUSINESS_TOOLS } from './AIBusinessToolCatalog';

export const chatAgentBusinessTools: readonly AgentToolDefinition[] = AI_BUSINESS_TOOLS
  .filter((tool) => tool.name !== 'generate_practice')
  .map((tool) => ({
    code: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as unknown as JsonObject,
    risk: AgentToolRisk.Write,
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  }));

export const chatAgentWebResearchTools: readonly AgentToolDefinition[] = [
  {
    code: 'web.search',
    description: '按需检索公开网页，返回最多 5 条标题、网址和短摘要。仅在问题依赖近期事实、考试公告、大纲或真题来源时调用；若多个检索方向彼此独立且都有必要，可在同一回合并行调用，查询范围和数量由当前目标决定；普通聊天不得调用，搜索结果不能直接声称为官方真题。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query', 'purpose'],
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 300 },
        purpose: { type: 'string', enum: ['current_affairs', 'true_question', 'exam_syllabus', 'general'] },
        freshness: { type: 'string', enum: ['day', 'week', 'month', 'year', 'any'] },
        limit: { type: 'number', minimum: 1, maximum: 5 }
      }
    },
    risk: AgentToolRisk.Read,
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  },
  {
    code: 'web.read_page',
    description: '读取当前 Agent 运行中 web.search 返回的一个公开网页正文。仅在搜索摘要不足以核实关键事实时调用；单次调用只读一个候选 URL，多个页面彼此独立且确有必要时可同回合调用，依赖搜索结果时必须分步；禁止读取任意 URL 或内网地址。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: { url: { type: 'string', minLength: 8, maxLength: 2_000 } }
    },
    risk: AgentToolRisk.Read,
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  }
];

const businessSkills: readonly AgentSkillDefinition[] = [
  { code: 'tutor.mock_generation', description: '根据用户明确的题量创建行测模拟考试。', toolCodes: ['generate_mock'], contextBudgetTokens: 500 },
  { code: 'tutor.essay_workflow', description: '处理申论练习生成和已完成作答的批改入口。', toolCodes: ['generate_essay', 'grade_essay'], contextBudgetTokens: 700 },
  { code: 'tutor.wrongbook_training', description: '根据用户指定范围创建历史错题重练或变式训练。', toolCodes: ['redo_wrongbook'], contextBudgetTokens: 600 },
  { code: 'tutor.digest_generation', description: '生成每日热点、知识积累或月度复盘内容。', toolCodes: ['generate_digest', 'generate_monthly_digest'], contextBudgetTokens: 600 },
  { code: 'tutor.interview_review', description: '为已经完成的面试模拟提供深度点评入口。', toolCodes: ['review_interview'], contextBudgetTokens: 500 },
  { code: 'research.current_affairs', description: '检索并核实近期公考时政，只返回有网址的证据；可自主判断是否并行检索多个必要且独立的方向，事实范围或日期不明确时先向用户确认。', toolCodes: ['web.search', 'web.read_page'], contextBudgetTokens: 900 },
  { code: 'research.true_questions', description: '研究公开真题来源和命题特征，并把核验后的候选送入统一扫描、确认、发布管线。网络结果先作为候选证据，来源身份不清时询问用户，不能直接标记为官方真题。', toolCodes: ['web.search', 'web.read_page', 'question_bank.scan', 'question_bank.resume', 'question_bank.confirm', 'question_bank.publish'], contextBudgetTokens: 1_600 },
  { code: 'research.exam_syllabus', description: '检索考试公告、大纲和政策原文，优先读取官方来源并明确日期、地区和适用考试。', toolCodes: ['web.search', 'web.read_page'], contextBudgetTokens: 900 }
];

const allSkills = [...tutorSkillCatalog, ...businessSkills];
const registry = new AgentToolRegistry();
registry.registerBundle({
  tools: [...tutorToolCatalog, ...chatAgentBusinessTools, ...chatAgentWebResearchTools],
  skills: allSkills
});

const planner = new ToolExposurePlanner(registry);
export const chatAgentSystemPromptComposer = new AgentSystemPromptComposer();

export const CHAT_AGENT_SKILL_SELECTOR_TOOL = 'agent.select_skills';

export interface ChatAgentCapabilityRequest {
  /** UI workflows may provide exact business context; free chat leaves this empty. */
  readonly preselectedSkillCodes?: readonly string[];
  /** Waiting-user resume activates the skill that owns the pending tool. */
  readonly pendingToolCode?: string;
}

export interface ChatAgentCapabilityPlan extends ToolExposurePlan {
  readonly capabilityCatalog: readonly AgentSkillDefinition[];
  readonly availableTools: readonly AgentToolDefinition[];
}

const capabilityCatalog = registry.listSkills();
const skillSelectorTool: AgentToolDefinition = {
  code: CHAT_AGENT_SKILL_SELECTOR_TOOL,
  description: '根据当前用户目标选择一到两个最相关的能力，以加载后续所需的最小工具集合。它不读取数据、不执行学习业务，也不代表操作已经完成。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['skillCodes'],
    properties: {
      skillCodes: {
        type: 'array',
        minItems: 1,
        maxItems: 2,
        uniqueItems: true,
        items: { type: 'string', enum: capabilityCatalog.map((skill) => skill.code) }
      }
    }
  },
  risk: AgentToolRisk.Read,
  requiresConfirmation: false,
  enabledFor: ['tutor_turn']
};

export function planChatAgentCapabilities(
  request: ChatAgentCapabilityRequest = {}
): ChatAgentCapabilityPlan {
  const pendingSkillCodes = request.pendingToolCode
    ? allSkills
        .filter((skill) => skill.toolCodes.includes(request.pendingToolCode!))
        .slice()
        .sort((left, right) => left.toolCodes.length - right.toolCodes.length)
        .slice(0, 1)
        .map((skill) => skill.code)
    : [];
  const skillCodes = request.preselectedSkillCodes?.length
    ? request.preselectedSkillCodes
    : pendingSkillCodes;
  const exposure = planner.plan(skillCodes, 'tutor_turn', {
    maxSkills: 2,
    maxTools: 8,
    maxContextBudgetTokens: 2_400
  });
  return {
    ...exposure,
    tools: [skillSelectorTool, ...exposure.tools],
    capabilityCatalog,
    availableTools: [skillSelectorTool, ...registry.listTools()]
  };
}

export function activateChatAgentSkills(skillCodes: readonly string[]): readonly AgentToolDefinition[] {
  const exposure = planner.plan(skillCodes, 'tutor_turn', {
    maxSkills: 2,
    maxTools: 8,
    maxContextBudgetTokens: 2_400
  });
  return exposure.tools;
}
