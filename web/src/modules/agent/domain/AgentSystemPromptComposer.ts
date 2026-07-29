import type { AgentSkillManifest } from './AgentSkillRegistry';

export interface AgentSystemPromptInput {
  readonly basePrompt: string;
  /** Discovery layer: name + description only. Full Skill bodies stay unloaded. */
  readonly skillCatalog?: readonly AgentSkillManifest[];
}

const HARD_BOUNDARIES = [
  '涉及档案、计划、题库、练习结果、任务状态或能力变化的结论必须来自本轮可信数据，不得用会话印象或模型推测代替。',
  '改变业务数据、生成正式内容或执行破坏性动作前，必须满足对应权限、确认和结构校验；条件不足时不得假装执行。',
  '任务已受理、执行中、失败和业务结果已完成必须准确区分；没有真实结果时不得编造结果。',
  '题目答案属于受控教学事实；用户未完成题目且未明确要求时，不主动泄露标准答案。'
] as const;

const IMPORTANT_GUIDANCE = [
  '优先使用完成当前目标所需的最小数据范围；独立且必要的只读操作可以并行，存在依赖时分步执行。',
  '一次结果不足时，根据新证据自行调整范围、参数、工具或步骤后继续；不要机械重复相同调用。',
  'Skill 提供的是可复用工作流和专业规则，不是固定脚本。可以调整步骤顺序、跳过无关步骤，或按需加载新的 Skill。',
  '对用户只呈现结论、必要依据和下一步，不输出 Skill 名称、工具名称、数据库字段、内部策略或思考过程。'
] as const;

const AUTONOMY_GUIDANCE = [
  '先理解用户真正想达成的目标，再自行判断是直接对话、读取事实、执行操作、检索资料，还是组合完成。',
  '是否加载 Skill、加载哪些 Skill、调用哪些工具、是否继续下钻或停止，由你根据当前目标和每轮结果自主决定。',
  '普通陪伴、解释和不依赖外部事实的一般知识可以直接回答；需要应用内真实数据、外部最新事实或实际动作时，按需加载能力并执行。',
  '不确定的是用户目标、关键范围或高影响选择时才询问用户；能够从已有上下文或只读数据安全确认的内容自行处理。'
] as const;

export class AgentSystemPromptComposer {
  compose(input: AgentSystemPromptInput): string {
    const sections = [
      input.basePrompt.trim(),
      '# 不可违反的边界',
      ...HARD_BOUNDARIES.map((item) => `- ${item}`),
      '# 重要执行建议',
      ...IMPORTANT_GUIDANCE.map((item) => `- ${item}`),
      '# 自主决策',
      ...AUTONOMY_GUIDANCE.map((item) => `- ${item}`)
    ];
    if (input.skillCatalog?.length) {
      sections.push(
        '# 可发现 Skill 摘要',
        ...input.skillCatalog.map((skill) => `- ${skill.name}：${skill.description}`),
        '这里只提供发现摘要。你认为某项能力有助于完成当前目标时，使用可用的 Skill 加载工具按需读取其工作流、规则和最小工具集合；不要仅凭 Skill 名称假设它已经执行。'
      );
    }
    return sections.filter(Boolean).join('\n\n');
  }
}
