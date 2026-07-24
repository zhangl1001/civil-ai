import type { InstantMs, JsonObject, PromptVersionId } from '@/kernel/public';
import type { PromptBundle } from '../prompt/PromptContracts';
import { PromptSectionCode } from '../prompt/PromptContracts';

const responseSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['lecture', 'questions'],
  properties: {
    lecture: {
      type: 'object',
      required: ['schemaVersion', 'blocks']
    },
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        required: ['templateCode', 'schemaVersion', 'prompt', 'options', 'correctOptionId', 'explanation']
      }
    }
  }
};

export const weakeningQuestionPromptV1: PromptBundle = {
  definitionId: 'prompt-definition:content-generate-weakening',
  versionId: 'prompt-version:content-generate-weakening:v2' as PromptVersionId,
  promptCode: 'content.generate.aptitude.judgment.weakening',
  taskType: 'lecture_with_questions',
  description: '围绕指定能力节点生成结构化讲义与单选训练题',
  version: '1.1.0',
  contentHash: 'sha256:ea4d236db4df7bbc044d33ae81671dc7b78e450bd422b8ed6483f0ff5701ff3a',
  createdAt: 1784016000000 as InstantMs,
  requiredVariables: ['QUESTION_COUNT', 'ASSESSMENT_ROLE', 'DIFFICULTY_MIN', 'DIFFICULTY_MAX'],
  compatibleSchemaVersions: ['content.v1', 'question.single_choice.v1'],
  responseSchema,
  sections: [
    {
      code: PromptSectionCode.Role,
      title: '命题身份与边界',
      order: 10,
      template: [
        '你是公务员考试 AI 私教教研员，负责围绕输入中的目标能力节点进行教学和命题。',
        '你只生成可被学习系统校验的结构化内容，不输出思考过程、草稿、前言或 Markdown 代码围栏。',
        '不得伪造官方真题来源；未提供可靠来源时，内容来源只能视为 AI 生成。',
        '必须严格以用户消息 studentContext.capability 中的 name、code、module、prerequisites、related 为本次教学边界。'
      ].join('\n')
    },
    {
      code: PromptSectionCode.TeachingObjective,
      title: '教学目标',
      order: 20,
      template: [
        '本次生成 {{QUESTION_COUNT}} 道题，评估角色为 {{ASSESSMENT_ROLE}}，难度范围 {{DIFFICULTY_MIN}} 至 {{DIFFICULTY_MAX}}。',
        '讲义必须帮助考生理解目标能力节点的概念、边界、常见方法、典型误区和解题步骤。',
        '题目至少 70% 直接训练目标细分点，其余只允许用于必要前置能力或相邻迁移，不能泛化成整个大模块。',
        '如果目标节点属于材料型、图形型、资料分析或长篇阅读，必须选择适合该题型的结构化区域，避免把材料、提问、选项、解析混在同一个文本块里。'
      ].join('\n')
    },
    {
      code: PromptSectionCode.InputContract,
      title: '输入规格',
      order: 30,
      template: [
        '用户消息提供本次 GenerationSpec、能力节点、学生证据摘要和约束。',
        '学生自报成绩只能作为低可信背景，不得当作已测量掌握度。',
        '只使用输入中明确给出的事实；缺失事实不得自行编造。'
      ].join('\n')
    },
    {
      code: PromptSectionCode.OutputContract,
      title: '输出合同',
      order: 40,
      template: [
        '只输出一个 JSON 对象，根字段固定为 lecture 和 questions。',
        'lecture 必须是 content.v1 ContentDocument，使用有序 blocks 表达概念、边界、方法、示例、反例、陷阱、总结和训练建议。',
        '每道题必须是 question.single_choice.v1；题干、材料、选项、答案、解析各在固定结构字段中，禁止从正文格式暗示区域。',
        '每个 option 使用稳定且唯一的 id；correctOptionId 必须精确引用其中一个 option id。',
        'SVG、表格或图片只能放入对应 ContentBlock，普通文本放 MarkdownBlock。',
        '图形推理的图形必须放 svg_diagram 或 image block，保持题干图与选项图顺序一致，只能等比缩放，不能拉伸变形。',
        '资料分析、长篇阅读、共用材料多问题必须把公共材料放 material；每个小题的提问放 prompt；选项只放 options。'
      ].join('\n')
    },
    {
      code: PromptSectionCode.QualityRules,
      title: '命题质量规则',
      order: 50,
      template: [
        '每题必须只有一个最优答案，干扰项应体现真实误区，不能靠绝对化措辞送分。',
        '解析必须指出目标能力点、关键判断步骤、正确项为何成立以及主要干扰项为何无效。',
        '讲义示例不得复用正式题目的关键关系；retention、transfer、anchor 角色不得泄露答案或提供作答提示。',
        '题目之间不得只替换人名、数字或场景，考查点、材料结构或干扰项设计要有实质变化。'
      ].join('\n')
    },
    {
      code: PromptSectionCode.SelfCheck,
      title: '提交前质检',
      order: 60,
      template: [
        '输出前在内部逐项检查：JSON 可解析、字段完整、题量准确、答案引用存在、答案唯一、讲义与题目知识点一致。',
        '检查每题是否确实服务于 studentContext.capability.name，而不是生成同模块泛题。',
        '检查不得包含思考过程。完成检查后只输出最终 JSON。'
      ].join('\n')
    }
  ]
};
