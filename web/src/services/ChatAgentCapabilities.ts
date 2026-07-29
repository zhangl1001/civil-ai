import type { JsonObject } from '@/kernel/public';
import {
  AgentSkillBundleCompiler,
  AgentExecutionBudgetTier,
  AgentSkillRegistry,
  AgentSystemPromptComposer,
  AgentToolRole,
  AgentToolRegistry,
  AgentToolRisk,
  agentExternalToolCatalog,
  agentSystemToolCatalog,
  tutorSkillCatalog,
  tutorToolCatalog,
  type AgentSkillBundle,
  type AgentSkillManifest,
  type AgentToolDefinition
} from '@/modules/agent/public';
import { AI_BUSINESS_TOOLS } from './AIBusinessToolCatalog';

export const chatAgentBusinessTools: readonly AgentToolDefinition[] = AI_BUSINESS_TOOLS
  .filter((tool) => tool.name !== 'generate_practice')
  .map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as unknown as JsonObject,
    risk: AgentToolRisk.Write,
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  }));

export const chatAgentMemoryTools: readonly AgentToolDefinition[] = [
  {
    name: 'memory.remember',
    description: '仅在用户明确要求记住稳定偏好、个人约束或待继续事项时，保存一条非业务记忆。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['memoryCode', 'statement', 'scope'],
      properties: {
        memoryCode: {
          type: 'string',
          enum: [
            'user.response_preference',
            'user.study_preference',
            'user.personal_constraint',
            'conversation.open_loop'
          ]
        },
        statement: { type: 'string', minLength: 1, maxLength: 500 },
        scope: { type: 'string', enum: ['session', 'exam_cycle', 'global'] },
        confidence: { type: 'number', minimum: 0.5, maximum: 1 }
      }
    },
    risk: AgentToolRisk.Write,
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  },
  {
    name: 'memory.forget',
    description: '按用户明确要求，遗忘一类个人偏好或待继续事项；不删除业务学习数据。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['memoryCode', 'scope'],
      properties: {
        memoryCode: {
          type: 'string',
          enum: [
            'user.response_preference',
            'user.study_preference',
            'user.personal_constraint',
            'conversation.open_loop'
          ]
        },
        scope: { type: 'string', enum: ['session', 'exam_cycle', 'global'] }
      }
    },
    risk: AgentToolRisk.Destructive,
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  }
];

const factualValidator = {
  name: 'agent.factual-grounding',
  description: '近期事实和本地业务结论必须来自本轮工具结果。'
} as const;

const completionValidator = {
  name: 'agent.no-false-completion',
  description: '任务受理、生成中和结果完成必须准确区分。'
} as const;

const requiredWriteValidator = {
  name: 'agent.requires-write',
  description: '生成、批改或研究派发场景必须成功执行对应写工具，不能用只读结果或聊天正文代替。'
} as const;

const businessSkills: readonly AgentSkillManifest[] = [
  defineSkill({
    name: 'tutor.personal_memory',
    description: '在用户明确要求时记住或遗忘回答偏好、学习偏好、个人约束和待继续事项。',
    allowedTools: ['memory.remember', 'memory.forget'],
    contextBudgetTokens: 400,
    workflow: workflow(
      '个人记忆管理',
      ['确认用户是在明确要求记住或遗忘。', '选择最小作用域和准确记忆类型。', '执行对应记忆工具并简短确认。'],
      ['只保存用户明确表达的内容；不保存模型推断、思考过程、分数、能力、题库或任务状态。'],
      ['意图或作用域不明确时先询问；业务事实应使用业务工具，不得写入个人记忆。']
    ),
    promptChapters: [chapter(
      'memory.boundary',
      '记忆边界',
      'global 只用于跨考期稳定偏好；exam_cycle 用于本考期约束；session 用于当前对话。用户要求忘记时使用 memory.forget。'
    )],
    validators: [{
      name: 'agent.explicit-memory-only',
      description: '只有用户明确表达的稳定内容才能写入，禁止保存推断和业务事实。'
    }]
  }),
  defineSkill({
    name: 'tutor.workspace_status',
    description: '检索本地题组、积累、讲义和异步任务的真实摘要与当前状态。',
    allowedTools: ['workspace.discover', 'task.read_status'],
    contextBudgetTokens: 550,
    workflow: workflow(
      '本地资源与任务查询',
      ['根据用户问题选择资源目录或任务状态。', '使用最小时间范围读取摘要。', '结果不足时调整资源类型、范围或关键词后继续查询。'],
      ['回答引用本轮本地查询结果，并明确区分不存在、筛选为空、排队、执行中、失败和已完成。'],
      ['查询为空时先检查范围是否过窄；仍为空时如实说明，不使用会话记忆猜测。']
    ),
    promptChapters: [chapter('workspace.discovery', '资源发现', 'workspace.discover 只列摘要和 ID；需要具体题组时再加载题库 Skill，下钻读取一个资源。')],
    validators: [factualValidator]
  }),
  defineSkill({
    name: 'tutor.mock_generation',
    description: '根据用户明确的考试范围和题量创建行测模拟考试。',
    allowedTools: ['generate_mock', 'task.read_status'],
    contextBudgetTokens: 500,
    workflow: workflow(
      '模拟考试创建',
      ['确认考试范围、题量和适用地区。', '调用 generate_mock 创建任务。', '调用 task.read_status 核验受理状态并返回后续入口。'],
      ['只有获得真实任务标识后才能说明已受理。'],
      ['条件不足时询问关键条件；创建失败时不得伪造试卷。']
    ),
    promptChapters: [chapter('mock.scope', '模考范围', '模考应围绕用户当前考试周期和明确题量，不自动扩大到全科或其他地区。')],
    validators: [requiredWriteValidator, completionValidator]
  }),
  defineSkill({
    name: 'tutor.essay_workflow',
    description: '创建申论练习，或批改用户已经完成的申论作答。',
    allowedTools: ['generate_essay', 'grade_essay', 'task.read_status'],
    contextBudgetTokens: 700,
    workflow: workflow(
      '申论练习与批改',
      ['判断用户要生成练习还是批改作答。', '生成调用 generate_essay；批改调用 grade_essay。', '依据工具结果说明状态和下一步。'],
      ['生成与批改必须调用对应工具；缺少作答内容时先询问。'],
      ['不确定任务类型时让用户确认；批改失败时保留原作答。']
    ),
    promptChapters: [chapter('essay.intent', '申论任务边界', '讲义、题目生成和作答批改属于不同动作，不得用一段文字假装完成业务操作。')],
    validators: [requiredWriteValidator, completionValidator]
  }),
  defineSkill({
    name: 'tutor.wrongbook_training',
    description: '根据用户指定范围创建历史错题重练或变式训练。',
    allowedTools: ['redo_wrongbook', 'task.read_status'],
    contextBudgetTokens: 600,
    workflow: workflow(
      '错题重练',
      ['确认模块、状态和题量范围。', '调用 redo_wrongbook 创建重练任务。', '返回真实任务状态。'],
      ['必须基于用户指定范围创建任务，不把单题讲解误作整组重练。'],
      ['范围为空时要求调整筛选；失败时不改变原错题数据。']
    ),
    promptChapters: [chapter('wrongbook.scope', '错题范围', '重练的是历史错题集合；单题深度讲解应留在题目详情对话。')],
    validators: [requiredWriteValidator, completionValidator]
  }),
  defineSkill({
    name: 'tutor.digest_generation',
    description: '生成每日热点、知识积累或月度复盘内容。',
    allowedTools: ['workspace.discover', 'generate_digest', 'generate_monthly_digest', 'task.read_status'],
    contextBudgetTokens: 600,
    workflow: workflow(
      '积累内容生成',
      ['先用 workspace.discover 核对目标日期和类型是否已有内容。', '没有同范围内容或活动任务时调用对应生成工具。', '用 task.read_status 核验受理状态后返回内容入口。'],
      ['必须成功派发生成任务并核验真实状态；不得把模型聊天正文当成正式积累内容。'],
      ['查询为空时扩大到 recent 核对范围；生成未受理时读取同类型活动任务，仍无结果才说明失败。']
    ),
    promptChapters: [chapter('digest.dynamic', '动态积累', '内容数量和深度由学习阶段、考试日期与近期能力情况决定，不固定写死。')],
    validators: [requiredWriteValidator, completionValidator]
  }),
  defineSkill({
    name: 'tutor.interview_review',
    description: '为已经完成的面试模拟创建深度点评和复盘任务。',
    allowedTools: ['review_interview', 'task.read_status'],
    contextBudgetTokens: 500,
    workflow: workflow(
      '面试复盘',
      ['确认已有可点评的面试记录。', '调用 review_interview。', '返回真实任务状态和复盘入口。'],
      ['没有面试记录时不得生成虚构点评。'],
      ['语音或记录缺失时要求用户补充。']
    ),
    promptChapters: [chapter('interview.evidence', '面试证据', '点评必须引用用户真实作答、时长和评分证据。')],
    validators: [factualValidator, requiredWriteValidator, completionValidator]
  }),
  defineSkill({
    name: 'research.current_affairs',
    description: '检索并核实近期公考时政，依据来源整理可学习的事实。',
    allowedTools: ['web.search', 'web.read_page'],
    contextBudgetTokens: 800,
    executionBudget: AgentExecutionBudgetTier.Research,
    workflow: workflow(
      '时政研究',
      ['明确日期范围和主题。', '对必要且独立的方向并行调用 web.search。', '摘要不足时调用 web.read_page 核实关键来源。', '基于证据整理结论并保留网址。'],
      ['关键近期事实有来源支撑；范围不明确时已向用户确认。'],
      ['搜索失败时缩小查询或说明网络限制；不得编造来源。']
    ),
    promptChapters: [chapter('research.sources', '来源规则', '优先政府和权威媒体原文；不同来源冲突时标明日期和差异。')],
    validators: [factualValidator]
  }),
  defineSkill({
    name: 'research.true_questions',
    description: '确认公开真题研究范围，并创建独立、可恢复的联网研究任务。',
    allowedTools: ['research_true_questions', 'task.read_status'],
    contextBudgetTokens: 600,
    executionBudget: AgentExecutionBudgetTier.Standard,
    workflow: workflow(
      '派发真题研究任务',
      ['确认年份、地区、考试类型、模块或考点中的必要范围。', '调用 research_true_questions 创建独立任务。', '调用 task.read_status 核验真实状态，不在当前对话中等待联网研究完成。'],
      ['已经获得真实任务标识；只说明任务已受理，不宣称真题已经入库。'],
      ['范围不明确时先询问用户；任务创建失败时保留用户条件供其重试。']
    ),
    promptChapters: [chapter('true-question.dispatch', '长任务边界', '聊天只负责确认范围和派发；联网检索、网页核验和草稿生成由独立任务执行，不占用后续对话轮次。')],
    resources: [{
      name: 'research-dispatch',
      description: '聊天与长工作流之间的隔离。',
      content: 'research_true_questions 只创建任务；任务完成后仍需用户在真题页面确认草稿，才可发布正式题组。'
    }],
    validators: [factualValidator, requiredWriteValidator, completionValidator]
  }),
  defineSkill({
    name: 'research.exam_syllabus',
    description: '检索考试公告、大纲和政策原文，并核实适用地区、日期和考试类型。',
    allowedTools: ['web.search', 'web.read_page'],
    contextBudgetTokens: 800,
    executionBudget: AgentExecutionBudgetTier.Research,
    workflow: workflow(
      '考试大纲研究',
      ['确认考试地区、类型和年份。', '调用 web.search 查找官方公告。', '调用 web.read_page 核实正文。', '总结适用范围、发布日期和关键变化。'],
      ['关键结论来自官方或明确标注的可靠来源。'],
      ['找不到官方原文时说明证据等级，不使用培训机构摘要冒充公告。']
    ),
    promptChapters: [chapter('syllabus.authority', '大纲权威性', '优先组织、人事考试和政府网站；引用时保留发布日期和适用考试。')],
    validators: [factualValidator]
  })
];

const allTools = [
  ...agentSystemToolCatalog,
  ...tutorToolCatalog,
  ...chatAgentBusinessTools,
  ...agentExternalToolCatalog,
  ...chatAgentMemoryTools
];
const allSkills = [...tutorSkillCatalog, ...businessSkills];
const toolRegistry = new AgentToolRegistry();
toolRegistry.registerAll(allTools);
const skillRegistry = new AgentSkillRegistry(toolRegistry);
skillRegistry.registerAll(allSkills);
const compiler = new AgentSkillBundleCompiler(skillRegistry, toolRegistry);

export const chatAgentSystemPromptComposer = new AgentSystemPromptComposer();
export const CHAT_AGENT_SKILL_SELECTOR_TOOL = 'agent.select_skills';

export interface ChatAgentCapabilityRequest {
  readonly preselectedSkillNames?: readonly string[];
  readonly pendingToolName?: string;
}

export interface ChatAgentCapabilityPlan extends AgentSkillBundle {
  readonly skillCatalog: readonly AgentSkillManifest[];
  readonly availableTools: readonly AgentToolDefinition[];
}

const skillCatalog = skillRegistry.list();
const skillSelectorTool: AgentToolDefinition = {
  name: CHAT_AGENT_SKILL_SELECTOR_TOOL,
  description: '按需加载有助于完成当前目标的 Skill 工作流和最小工具集合。由你判断是否需要、选择哪些；每次最多加载两个，后续可依据结果继续加载其他 Skill。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['skillNames'],
    properties: {
      skillNames: {
        type: 'array',
        minItems: 1,
        maxItems: 2,
        uniqueItems: true,
        items: { type: 'string', enum: skillCatalog.map((skill) => skill.name) }
      }
    }
  },
  risk: AgentToolRisk.Read,
  role: AgentToolRole.SkillSelector,
  requiresConfirmation: false,
  enabledFor: ['tutor_turn']
};

/**
 * The foundational read-only system surface is always visible to the model.
 * This includes device facts, local grounding, and bounded public-web access.
 * Business writes and expensive workflows remain Skill-loaded.
 */
const baseReadOnlyTools = [
  'system.read_clock',
  'web.search',
  'web.read_page',
  'student.read_profile',
  'tutor.read_daily_context',
  'workspace.discover',
  'task.read_status'
] as const;

export function planChatAgentCapabilities(
  request: ChatAgentCapabilityRequest = {}
): ChatAgentCapabilityPlan {
  const pendingSkillNames = request.pendingToolName
    ? allSkills
        .filter((skill) => skill.allowedTools.includes(request.pendingToolName!))
        .slice()
        .sort((left, right) => left.allowedTools.length - right.allowedTools.length)
        .slice(0, 1)
        .map((skill) => skill.name)
    : [];
  const skillNames = request.preselectedSkillNames?.length
    ? request.preselectedSkillNames
    : pendingSkillNames;
  const bundle = compileChatAgentSkills(skillNames);
  const baseTools = baseReadOnlyTools.map((name) => toolRegistry.get(name)).filter(
    (tool): tool is AgentToolDefinition => Boolean(tool)
  );
  return {
    ...bundle,
    tools: uniqueTools([skillSelectorTool, ...baseTools, ...bundle.tools]),
    skillCatalog,
    availableTools: [skillSelectorTool, ...toolRegistry.list()]
  };
}

function uniqueTools(tools: readonly AgentToolDefinition[]): readonly AgentToolDefinition[] {
  return [...new Map(tools.map((tool) => [tool.name, tool])).values()];
}

export function compileChatAgentSkills(skillNames: readonly string[]): AgentSkillBundle {
  return compiler.compile(skillNames, 'tutor_turn', {
    maxSkills: 2,
    maxTools: 8,
    maxContextBudgetTokens: 2_400
  });
}

function defineSkill(
  input: Omit<AgentSkillManifest, 'version' | 'dependencies' | 'conflicts' | 'resources' | 'executionBudget'>
    & Partial<Pick<AgentSkillManifest, 'resources' | 'executionBudget'>>
): AgentSkillManifest {
  return {
    ...input,
    version: '1.0.0',
    dependencies: [],
    conflicts: [],
    resources: input.resources ?? [],
    executionBudget: input.executionBudget ?? AgentExecutionBudgetTier.Standard
  };
}

function workflow(
  description: string,
  steps: readonly string[],
  completionCriteria: readonly string[],
  failureRecovery: readonly string[]
): AgentSkillManifest['workflow'] {
  return {
    name: description,
    description,
    steps: steps.map((step, index) => ({ name: `步骤 ${index + 1}`, description: step })),
    completionCriteria,
    failureRecovery
  };
}

function chapter(name: string, title: string, content: string): AgentSkillManifest['promptChapters'][number] {
  return { name, title, content };
}
