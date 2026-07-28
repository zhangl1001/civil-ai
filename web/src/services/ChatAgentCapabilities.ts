import type { JsonObject } from '@/kernel/public';
import {
  AgentSkillRouter,
  AgentSystemPromptComposer,
  AgentToolRegistry,
  AgentToolRisk,
  ToolExposurePlanner,
  tutorSkillCatalog,
  tutorToolCatalog,
  type AgentSkillDefinition,
  type AgentSkillRoutingRule,
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

const routingRules: readonly AgentSkillRoutingRule[] = [
  route('research.true_questions', 136, /(?:网上|网络|搜索|查找|找一下|研究).{0,12}(?:真题|历年题|试卷)|(?:真题|历年题).{0,12}(?:来源|官网|公告)/),
  route('research.exam_syllabus', 134, /(?:搜索|查询|最新|官方).{0,12}(?:考试大纲|招考公告|考试公告|政策原文)|(?:考试大纲|招考公告).{0,12}(?:官网|来源|更新)/),
  route('tutor.question_bank_ingestion', 130, /(?:导入|录入|上传|扫描|入库|解析).{0,12}(?:真题|题目|试卷|文件|PDF|图片)|(?:重新|再)(?:录入|导入|上传|扫描)|(?:PDF|OCR).{0,12}(?:题目|试卷)/i),
  route('tutor.goal_management', 125, /(?:修改|调整|设置|查看|当前|我的).{0,8}(?:目标分|目标成绩)|目标分/i),
  route('tutor.mock_generation', 120, /模考|模拟考试|行测套卷|整套试卷/),
  route('tutor.essay_workflow', 120, /申论/),
  route('tutor.interview_review', 120, /面试(?:点评|复盘|模拟|练习)|结构化面试/),
  route('research.current_affairs', 118, /(?:搜索|查找|整理|分析|看看).{0,12}(?:时政|热点|政策|新闻)|(?:今日|每日|近期|最新).{0,8}(?:时政|热点|政策|新闻)/),
  route('tutor.digest_generation', 115, /每日积累|每日热点|每日知识|时政积累|月度复盘|时政月报/),
  route('tutor.wrongbook_training', 112, /错题.{0,8}(?:重做|重练|复习|变式)|重做.{0,6}错题/),
  route('tutor.practice_library', 108, /题库|题组|练习记录|练习历史|正确率|战绩|做得怎么样|生成.{0,8}(?:了吗|没有|状态)|(?:题目|练习).{0,8}(?:有吗|在哪)/),
  route('tutor.objective_practice', 104, /生题|出题|刷题|专项练习|针对性练习|生成.{0,8}(?:资料分析|判断推理|言语理解|数量关系|常识判断|行测题|练习题)/),
  route('tutor.daily_coaching', 100, /今天.{0,8}(?:学|练|做|安排)|今日.{0,8}(?:计划|学习|训练)|下一步|学习计划|复习计划|薄弱点|能力变化/)
];

const router = new AgentSkillRouter(routingRules, 2);
const planner = new ToolExposurePlanner(registry);
export const chatAgentSystemPromptComposer = new AgentSystemPromptComposer();

export function planChatAgentCapabilities(
  text: string,
  pendingToolCode?: string
): ToolExposurePlan {
  const skillCodes = pendingToolCode
    ? allSkills
        .filter((skill) => skill.toolCodes.includes(pendingToolCode))
        .slice()
        .sort((left, right) => left.toolCodes.length - right.toolCodes.length)
        .slice(0, 1)
        .map((skill) => skill.code)
    : router.route({ text });
  return planner.plan(skillCodes, 'tutor_turn', {
    maxSkills: 2,
    maxTools: 8,
    maxContextBudgetTokens: 2_400
  });
}

function route(skillCode: string, priority: number, pattern: RegExp): AgentSkillRoutingRule {
  return {
    skillCode,
    priority,
    matches: ({ text }) => pattern.test(text.trim())
  };
}
