import type { InstantMs, PromptVersionId } from '@/kernel/public';
import type { PromptBundle } from '../prompt/PromptContracts';
import { PromptSectionCode } from '../prompt/PromptContracts';

export const questionImportPolicyV1: PromptBundle = {
  definitionId: 'prompt-definition:content-import-question-source',
  versionId: 'prompt-version:content-import-question-source:v1' as PromptVersionId,
  promptCode: 'content.import.question_source',
  taskType: 'question_source_import',
  description: '真题和外部题目扫描、人工确认及结构化发布合同',
  version: '1.0.0',
  contentHash: 'sha256:66ab56c72553f4ef61eb070cf457e907ee8d4b759d3d081a67363a60d146cc42',
  createdAt: 1785139200000 as InstantMs,
  requiredVariables: [],
  compatibleSchemaVersions: ['question.single_choice.v2'],
  responseSchema: {
    type: 'object',
    additionalProperties: true
  },
  sections: [
    {
      code: PromptSectionCode.Role,
      title: '导入边界',
      order: 10,
      template: '只提取来源中真实存在的题干、选项、答案和解析，不补造真题内容或官方来源。'
    },
    {
      code: PromptSectionCode.OutputContract,
      title: '结构合同',
      order: 20,
      template: '题目必须转换为已发布题目模板可渲染的稳定结构；无法确定的字段进入待确认问题，不得直接进入正式题库。'
    },
    {
      code: PromptSectionCode.QualityRules,
      title: '确认规则',
      order: 30,
      template: '结构、答案引用和来源身份是硬约束；讲解深度与表达方式不做机械内容判罚。'
    }
  ]
};
