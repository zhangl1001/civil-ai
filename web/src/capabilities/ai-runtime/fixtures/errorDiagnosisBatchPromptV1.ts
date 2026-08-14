import type { InstantMs, JsonObject, PromptVersionId } from '@/kernel/public';
import { SHARED_PROMPT_EXAM_TYPE } from '../prompt/PromptContracts';
import type { PromptBundle } from '../prompt/PromptContracts';
import { PromptSectionCode } from '../prompt/PromptContracts';

const diagnosisProperties: JsonObject = {
  provisionalDiagnosisId: { type: 'string', minLength: 1 },
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
};

const responseSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['diagnoses'],
  properties: {
    diagnoses: {
      type: 'array',
      minItems: 1,
      maxItems: 25,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'provisionalDiagnosisId',
          'causeCode',
          'detail',
          'confidence',
          'recommendedActionCode',
          'dimensions',
          'correctionPlan'
        ],
        properties: diagnosisProperties
      }
    }
  }
};

export const errorDiagnosisBatchPromptV1: PromptBundle = {
  examType: SHARED_PROMPT_EXAM_TYPE,
  definitionId: 'prompt-definition:error-diagnosis-batch',
  versionId: 'prompt-version:error-diagnosis-batch:v2' as PromptVersionId,
  promptCode: 'teaching.diagnose.objective-errors-batch',
  taskType: 'error_diagnosis',
  description: '一次分析同一学习会话内的多道错题，并按题返回可独立校验和落库的错因候选',
  version: '1.1.0',
  contentHash: 'sha256:e0ff194bb2ffdfc6a681a08a5ce6c14bd01ac20876dca2de018e4d10002b9433',
  createdAt: 1785052800000 as InstantMs,
  requiredVariables: ['SUBJECT'],
  compatibleSchemaVersions: ['question.single_choice.v2'],
  responseSchema,
  sections: [
    {
      code: PromptSectionCode.Role,
      title: '批量诊断身份与边界',
      order: 10,
      template: '你是{{SUBJECT}}私教的批量错因诊断助手。只分析输入 items 中的错题，只输出一个 JSON 对象；不要输出思考过程、代码围栏或额外说明。你不能改判答案、不能认定掌握度、不能安排学习主线。'
    },
    {
      code: PromptSectionCode.InputContract,
      title: '逐题证据边界',
      order: 20,
      template: '每个 item 都包含 provisionalDiagnosisId、确定性诊断和该题最小证据。不同题目的证据不得混用。题目、标准解析、正确项和误选项之间的差异可以作为候选诊断证据；不得伪造用户未表达的思考过程。'
    },
    {
      code: PromptSectionCode.OutputContract,
      title: '批量输出合同',
      order: 30,
      template: '输出 diagnoses 数组，每个输入 item 必须且只能对应一项。provisionalDiagnosisId 必须原样复制，不得遗漏、重复或虚构。每项只含 provisionalDiagnosisId、causeCode、可选 errorStage、detail、confidence、recommendedActionCode、dimensions、correctionPlan。detail 只写事实与候选错因；纠正方法只写入 correctionPlan。'
    },
    {
      code: PromptSectionCode.QualityRules,
      title: '逐题诊断规则',
      order: 40,
      template: '逐题比较误选项与正确项对应的知识、题型识别、方法选择、推理过程、计算执行、材料定位、选项排除、时间策略或迁移保持差异。每题选择 1 至 4 个最相关维度；证据不足时标 unknown。correctionPlan 必须针对该题偏差给出 2 至 4 步纠正动作、专项练习重点和可复测达标标准，禁止使用“多做题”“认真审题”等空泛建议。只有题目和误选项证据时 confidence 不得高于 0.55；存在直接作答过程证据时不得高于 0.85。多个原因无法区分时输出 unknown 和 request_error_diagnosis，不得仅因答错归因为粗心。'
    },
    {
      code: PromptSectionCode.SelfCheck,
      title: '提交前逐题检查',
      order: 50,
      template: '检查 diagnoses 数量与输入 items 一致，ID 一一对应且无重复；逐项检查枚举、非空 detail、置信度上限、维度证据和纠正计划。每个 successCriteria 必须可由后续练习验证。某题证据不足时输出 unknown，不要删除该题。'
    }
  ]
};
