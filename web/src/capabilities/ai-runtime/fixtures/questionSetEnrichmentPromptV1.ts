import type { InstantMs, JsonObject, PromptVersionId } from '@/kernel/public';
import { SHARED_PROMPT_EXAM_TYPE } from '../prompt/PromptContracts';
import type { PromptBundle } from '../prompt/PromptContracts';
import { PromptSectionCode } from '../prompt/PromptContracts';

const explanationSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    knowledgePoint: { type: 'string', minLength: 1 },
    conclusion: { type: 'string', minLength: 1 },
    steps: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', minLength: 1 }
    },
    optionAnalysis: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['optionId', 'verdict', 'analysis'],
        properties: {
          optionId: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] },
          verdict: { type: 'string', enum: ['correct', 'incorrect'] },
          analysis: { type: 'string', minLength: 1 }
        }
      }
    },
    pitfalls: {
      type: 'array',
      maxItems: 6,
      items: { type: 'string', minLength: 1 }
    }
  }
};

const responseSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['explanations'],
  properties: {
    lecture: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sections: {
          type: 'array',
          maxItems: 12,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['markdown'],
            properties: {
              kind: {
                type: 'string',
                enum: ['concept', 'boundary', 'method', 'example', 'trap', 'summary', 'training']
              },
              title: { type: 'string', minLength: 1 },
              markdown: { type: 'string', minLength: 1 }
            }
          }
        }
      }
    },
    explanations: {
      type: 'array',
      maxItems: 25,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['questionId', 'explanation'],
        properties: {
          questionId: { type: 'string', minLength: 1 },
          explanation: explanationSchema
        }
      }
    }
  }
};

export const questionSetEnrichmentPromptV1: PromptBundle = {
  examType: SHARED_PROMPT_EXAM_TYPE,
  definitionId: 'prompt-definition:content-enrich-question-set',
  versionId: 'prompt-version:content-enrich-question-set:v1' as PromptVersionId,
  promptCode: 'content.enrich.question_set',
  taskType: 'content_enrichment',
  description: '在题组可作答后，仅补全缺失的讲义和逐题解析，不改动题干、选项、答案或材料',
  version: '1.0.0',
  contentHash: 'sha256:5a36f462335cebea7c99a2d64c59e189c9d137e04e340c12ae7c19311621c67f',
  createdAt: 1785283200000 as InstantMs,
  requiredVariables: [],
  compatibleSchemaVersions: ['content.v1', 'question.single_choice.v2'],
  responseSchema,
  sections: [
    {
      code: PromptSectionCode.Role,
      title: '补全职责与不可变边界',
      order: 10,
      template: [
        '你是公务员考试 AI 私教的内容补全助手。',
        '题组的题干、材料、选项和答案已经发布并可能正在被用户作答，它们全部不可修改。',
        '你只补全输入 missingBlocks 指定的讲义或解析，不输出思考过程、前言、代码围栏或其他字段。'
      ].join('\n')
    },
    {
      code: PromptSectionCode.InputContract,
      title: '最小输入合同',
      order: 20,
      template: [
        '输入只包含当前题组、目标能力和确实缺失的补充块。',
        '每道待补解析题提供稳定 questionId、题干、选项和正确答案；questionId 必须原样返回。',
        '不得补写输入未要求的题目，不得把其他题目的解析混入当前题。'
      ].join('\n')
    },
    {
      code: PromptSectionCode.OutputContract,
      title: '块级输出合同',
      order: 30,
      template: [
        '只输出一个 JSON 对象，explanations 数组必须存在；需要讲义时再输出 lecture。',
        'lecture.sections 是可组合教学章节，markdown 保存完整内容，章节数量和组织方式由教学需要决定。',
        '解析使用 knowledgePoint、conclusion、steps、optionAnalysis、pitfalls 组合；应给出足以支持用户复盘的结论和方法。',
        'optionAnalysis 如果提供，只能引用本题真实选项，且只有正确答案对应项 verdict 为 correct。'
      ].join('\n')
    },
    {
      code: PromptSectionCode.QualityRules,
      title: '补全质量',
      order: 40,
      template: [
        '讲义围绕目标能力讲清概念边界、识别方法、解题路径和典型陷阱，避免空洞口号。',
        '解析必须与题干、选项和正确答案一致，不能改判，不能伪造用户思考过程。',
        '数学公式使用 KaTeX 兼容 LaTeX；表格使用标准 GFM Markdown。'
      ].join('\n')
    },
    {
      code: PromptSectionCode.SelfCheck,
      title: '提交前检查',
      order: 50,
      template: [
        '检查每个 questionId 均来自输入且只出现一次。',
        '检查没有输出题干、材料、选项、答案等不可变核心字段。',
        '检查每个输出块都有实际教学内容，然后只提交最终 JSON。'
      ].join('\n')
    }
  ]
};
