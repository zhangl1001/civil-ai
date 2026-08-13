import type { InstantMs, JsonObject, PromptVersionId } from '@/kernel/public';
import { SHARED_PROMPT_EXAM_TYPE } from '../prompt/PromptContracts';
import type { PromptBundle } from '../prompt/PromptContracts';
import { PromptSectionCode } from '../prompt/PromptContracts';

const responseSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'causeCode',
    'detail',
    'confidence',
    'recommendedActionCode',
    'dimensions',
    'correctionPlan'
  ],
  properties: {
    causeCode: {
      type: 'string',
      enum: [
        'concept_gap',
        'recognition_error',
        'method_selection_error',
        'reasoning_error',
        'calculation_error',
        'evidence_extraction_error',
        'trap_misjudgment',
        'time_management_error',
        'careless_error',
        'transfer_failure',
        'retention_failure',
        'unknown'
      ]
    },
    errorStage: { type: 'string' },
    detail: { type: 'string', minLength: 1, maxLength: 500 },
    confidence: { type: 'number', minimum: 0, maximum: 0.85 },
    recommendedActionCode: { type: 'string', minLength: 1, maxLength: 100 },
    dimensions: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'status', 'evidence'],
        properties: {
          code: {
            type: 'string',
            enum: [
              'knowledge_concept',
              'question_recognition',
              'method_selection',
              'reasoning_process',
              'evidence_extraction',
              'calculation_execution',
              'option_elimination',
              'time_strategy',
              'transfer_retention'
            ]
          },
          status: { type: 'string', enum: ['gap', 'risk', 'adequate', 'unknown'] },
          evidence: { type: 'string', minLength: 1, maxLength: 160 }
        }
      }
    },
    correctionPlan: {
      type: 'object',
      additionalProperties: false,
      required: ['objective', 'steps', 'practiceFocus', 'successCriteria'],
      properties: {
        objective: { type: 'string', minLength: 1, maxLength: 120 },
        steps: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: { type: 'string', minLength: 1, maxLength: 160 }
        },
        practiceFocus: { type: 'string', minLength: 1, maxLength: 160 },
        successCriteria: { type: 'string', minLength: 1, maxLength: 160 }
      }
    }
  }
};

export const errorDiagnosisPromptV1: PromptBundle = {
  examType: SHARED_PROMPT_EXAM_TYPE,
  definitionId: 'prompt-definition:error-diagnosis',
  versionId: 'prompt-version:error-diagnosis:v4' as PromptVersionId,
  promptCode: 'teaching.diagnose.objective-error',
  taskType: 'error_diagnosis',
  description: '根据题目、误选项、标准解析和作答观察生成可核验的结构化错因候选',
  version: '1.3.0',
  contentHash: 'sha256:13fea496311f6ba433b27d064c183cd714b7cb311ee8e9ab020745b3cce1ee76',
  createdAt: 1784016000000 as InstantMs,
  requiredVariables: ['SUBJECT'],
  compatibleSchemaVersions: ['question.single_choice.v2'],
  responseSchema,
  sections: [
    {
      code: PromptSectionCode.Role,
      title: '诊断身份与边界',
      order: 10,
      template: '你是{{SUBJECT}}私教的错因诊断助手。只根据输入事实输出一个 JSON 对象；不要输出思考过程、代码围栏。你不能改判答案、不能认定掌握度、不能安排学习主线。'
    },
    {
      code: PromptSectionCode.InputContract,
      title: '输入证据边界',
      order: 20,
      template: '输入包含题干、选项、标准答案、标准解析、用户答案、确定性判分、用时与改答次数。题目语义、标准解析及用户误选项之间的差异可以作为候选诊断证据；不得伪造用户未表达的内心想法。'
    },
    {
      code: PromptSectionCode.OutputContract,
      title: '输出合同',
      order: 30,
      template: '只输出 causeCode、可选 errorStage、detail、confidence、recommendedActionCode、dimensions 和 correctionPlan。detail 只解释观察事实与候选错因，不再混写纠正建议。dimensions 选 1 至 4 个最相关维度并写明证据；证据不足的维度标为 unknown。correctionPlan 必须包含纠正目标、2 至 4 个可执行步骤、专项练习重点和可复测的达标标准。存在直接作答过程证据时 confidence 不得高于 0.85；只有题目和误选项证据时不得高于 0.55。'
    },
    {
      code: PromptSectionCode.QualityRules,
      title: '教学诊断规则',
      order: 40,
      template: '优先比较误选项与正确项对应的知识、题型识别、方法选择、推理过程、计算执行、材料定位、选项排除、时间策略或迁移保持差异。能从差异形成单一较合理候选时输出对应 causeCode；多个原因无法区分时输出 unknown 和 request_error_diagnosis。不得仅因答错归因为粗心。纠正步骤必须对应本题暴露的具体偏差，不能只写“多做题”“认真审题”或“加强练习”。诊断是候选，仍须用户确认或纠正。'
    },
    {
      code: PromptSectionCode.SelfCheck,
      title: '提交前检查',
      order: 50,
      template: '检查 causeCode 与 dimensions 枚举合法，detail 非空且不混入纠正建议，confidence 满足证据上限，recommendedActionCode 与候选原因一致；correctionPlan 的步骤能直接执行，successCriteria 可以在后续练习中验证，且未包含模型思考过程。'
    }
  ]
};
