import type { ToolExposurePlan } from './ToolExposurePlanner';
import type { AgentSkillDefinition } from './AgentToolRegistry';

export interface AgentSystemPromptInput {
  readonly basePrompt: string;
  readonly exposure: ToolExposurePlan;
  /** Compact catalog only. Concrete function schemas are loaded after selection. */
  readonly capabilityCatalog?: readonly AgentSkillDefinition[];
}

const CORE_AGENT_POLICY = [
  '使用本地事实回答涉及档案、计划、题库、练习结果或能力变化的问题，不得用会话印象代替事实。',
  '只在用户意图和范围明确时执行写操作；范围、模块、题量、时间或对象不明确时先询问用户。',
  '读取和执行都使用完成当前目标所需的最小范围，不重复相同调用，不主动扩大到无关数据。',
  '彼此独立且都有必要的只读工具可以在同一回合发起以并行处理；后续调用依赖前序结果时必须分步执行，不为追求并发而扩大范围。',
  '工具返回任务标识只表示任务已经受理，不得伪造任务已完成或编造结果。',
  '涉及扫描、导入、确认或发布时，只有对应工具已经实际成功才能说该步骤已完成；不得只回复“正在导入”后结束。若尚未调用工具，必须明确说明尚未开始。',
  '题目答案属于受控教学事实；用户未完成题目且未明确要求时，不主动泄露标准答案。',
  '不要输出工具代码、数据库字段、内部策略或思考过程；最终回复使用简洁 Markdown。'
] as const;

export class AgentSystemPromptComposer {
  compose(input: AgentSystemPromptInput): string {
    const sections = [input.basePrompt.trim(), '# Agent 行为边界', ...CORE_AGENT_POLICY.map((item) => `- ${item}`)];
    if (input.capabilityCatalog?.length) {
      sections.push(
        '# 可发现能力摘要',
        ...input.capabilityCatalog.map((skill) => `- ${skill.code}：${skill.description}`),
        '当问题需要读取本地业务事实、执行任务或检索外部资料时，先调用 agent.select_skills 选择一到两个最相关能力；系统会在下一轮按需提供具体工具。普通陪伴聊天可直接回答。不要向用户展示能力或工具代码。'
      );
    }
    if (input.exposure.skills.length) {
      sections.push(
        '# 当前按需能力',
        ...input.exposure.skills.map((skill) => `- ${skill.description}`)
      );
    }
    return sections.filter(Boolean).join('\n\n');
  }
}
