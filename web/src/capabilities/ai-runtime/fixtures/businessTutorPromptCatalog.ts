import type { InstantMs, JsonObject, PromptVersionId } from '@/kernel/public';
import type { PromptBundle, PromptSection } from '../prompt/PromptContracts';
import { PromptSectionCode } from '../prompt/PromptContracts';
import { GENERATION_AUTONOMY_LIMITS } from '../prompt/GenerationBoundaryPolicy';

export const BusinessTutorPromptCode = {
  EssayGeneration: 'content.generate.essay.question',
  EssayGrade: 'teaching.grade.essay',
  InterviewReview: 'teaching.review.interview',
  DailyDigest: 'content.generate.digest.daily',
  MonthlyDigest: 'content.generate.digest.monthly',
  StudyLecture: 'content.generate.study.lecture'
} as const;

const EMPTY_SCHEMA: JsonObject = {};
const CREATED_AT = 1784937600000 as InstantMs;

const essayGenerationSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'material', 'requirement', 'lecture'],
  properties: {
    title: { type: 'string', minLength: 1 },
    material: { type: 'string', minLength: 1 },
    requirement: { type: 'string', minLength: 1 },
    lecture: {
      type: 'object',
      additionalProperties: false,
      required: ['knowledgePoint', 'title', 'summary', 'clues', 'methods', 'structure', 'warnings', 'cases', 'drills'],
      properties: {
        knowledgePoint: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1 },
        summary: { type: 'string', minLength: 1 },
        clues: { type: 'array', maxItems: GENERATION_AUTONOMY_LIMITS.teachingListItems.max, items: { type: 'string', minLength: 1 } },
        methods: { type: 'array', maxItems: GENERATION_AUTONOMY_LIMITS.teachingListItems.max, items: { type: 'string', minLength: 1 } },
        structure: { type: 'array', maxItems: GENERATION_AUTONOMY_LIMITS.teachingListItems.max, items: { type: 'string', minLength: 1 } },
        warnings: { type: 'array', maxItems: GENERATION_AUTONOMY_LIMITS.teachingListItems.max, items: { type: 'string', minLength: 1 } },
        cases: { type: 'array', maxItems: GENERATION_AUTONOMY_LIMITS.teachingListItems.max, items: { type: 'string', minLength: 1 } },
        drills: { type: 'array', maxItems: GENERATION_AUTONOMY_LIMITS.teachingListItems.max, items: { type: 'string', minLength: 1 } }
      }
    }
  }
};

const essayGradeSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'feedback', 'confidence', 'suggestions', 'dimensions'],
  properties: {
    score: { type: 'number', minimum: 0, maximum: 100 },
    feedback: { type: 'string', minLength: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    suggestions: { type: 'array', items: { type: 'string' } },
    dimensions: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: {
        type: 'object',
        required: ['code', 'name', 'score', 'comment', 'evidence'],
        properties: {
          code: { type: 'string', enum: ['relevance', 'evidence_extraction', 'structure', 'reasoning', 'expression'] },
          name: { type: 'string' },
          score: { type: 'number', minimum: 0, maximum: 100 },
          comment: { type: 'string' },
          evidence: { type: 'string' }
        }
      }
    }
  }
};

const interviewReviewSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'confidence', 'feedbackMarkdown', 'suggestions', 'dimensions'],
  properties: {
    score: { type: 'number', minimum: 0, maximum: 100 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    feedbackMarkdown: { type: 'string', minLength: 1 },
    suggestions: { type: 'array', items: { type: 'string' } },
    dimensions: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        required: ['code', 'name', 'score', 'comment', 'evidence'],
        properties: {
          code: { type: 'string', enum: ['content', 'structure', 'expression', 'fluency'] },
          name: { type: 'string' },
          score: { type: 'number', minimum: 0, maximum: 100 },
          comment: { type: 'string' },
          evidence: { type: 'string' }
        }
      }
    }
  }
};

function section(
  code: typeof PromptSectionCode[keyof typeof PromptSectionCode],
  title: string,
  order: number,
  template: string
): PromptSection {
  return { code, title, order, template };
}

function bundle(input: {
  code: string;
  taskType: string;
  description: string;
  hash: string;
  version?: string;
  schema?: JsonObject;
  sections: readonly PromptSection[];
}): PromptBundle {
  const suffix = input.code.replaceAll('.', '-');
  const version = input.version ?? '1.0.0';
  return {
    definitionId: `prompt-definition:${suffix}`,
    versionId: `prompt-version:${suffix}:${input.version ? `v${version}` : 'v1'}` as PromptVersionId,
    promptCode: input.code,
    taskType: input.taskType,
    description: input.description,
    version,
    contentHash: input.hash,
    createdAt: CREATED_AT,
    requiredVariables: [],
    compatibleSchemaVersions: ['learning-asset.v1'],
    responseSchema: input.schema ?? EMPTY_SCHEMA,
    sections: input.sections
  };
}

export const businessTutorPromptCatalog: readonly PromptBundle[] = [
  bundle({
    code: BusinessTutorPromptCode.EssayGeneration,
    taskType: 'essay_question_generation',
    description: '生成与细分申论知识点配套的材料、题目和讲义',
    version: '1.1.0',
    hash: 'sha256:ffc46bd7158ee0ee0b286597a08f2996b0d06439b6759b43fc4074b1b6dfd869',
    schema: essayGenerationSchema,
    sections: [
      section(PromptSectionCode.Role, '命题身份与边界', 10, '你是公务员考试申论教研员。内部完成选点、构题和质检，只输出最终 JSON，不输出思考过程、草稿、前言或代码围栏。'),
      section(PromptSectionCode.TeachingObjective, '教学目标', 20, '围绕输入指定的主题和唯一细分知识点，形成可先学讲义、再做题训练的完整课件。材料、作答要求和讲义必须相互对应。'),
      section(PromptSectionCode.InputContract, '输入规格', 30, '输入包含主题、题型和小问数量。不得编造官方真题来源；缺少可靠来源时视为 AI 生成内容。'),
      section(PromptSectionCode.OutputContract, '输出合同', 40, '只输出 JSON 对象，包含 title、material、requirement、lecture。lecture 的稳定渲染槽位为 knowledgePoint、title、summary、clues、methods、structure、warnings、cases、drills；各列表按教学需要自主决定条数，可以留空，不得为凑数量重复内容。material 按资料分段，requirement 明确题型、对象、字数和限定。'),
      section(PromptSectionCode.QualityRules, '内容质量', 50, '重要内容必须讲清：考什么、如何识别、怎么作答、方法适用边界和为何易错。呈现顺序、篇幅、案例数量与训练数量由内容复杂度决定。讲义是知识点教材，不得写成单题解析；材料应包含足以支撑作答的事实、主体、矛盾、做法和场景。'),
      section(PromptSectionCode.SelfCheck, '提交前质检', 60, '检查 JSON 可解析、字段完整、讲义与题目知识点一致、材料足以支撑作答、没有思考过程，然后只输出最终 JSON。')
    ]
  }),
  bundle({
    code: BusinessTutorPromptCode.EssayGrade,
    taskType: 'essay_grade',
    description: '基于给定材料和评分量表批改申论作答',
    version: '1.1.0',
    hash: 'sha256:dcee70677c24122eb7c5680aa7ae488c6f7a507286f5b183882cec59b0136200',
    schema: essayGradeSchema,
    sections: [
      section(PromptSectionCode.Role, '阅卷身份与边界', 10, '你是严格的公务员申论阅卷老师。必须基于给定材料、作答要求和考生原文举证，不能只按文风泛评，不输出思考过程。'),
      section(PromptSectionCode.TeachingObjective, '批改目标', 20, '使用 essay_rubric@1.0.0 给出可落库、可驱动后续训练的评分、证据、错因和改进动作。'),
      section(PromptSectionCode.InputContract, '输入规格', 30, '输入包含题目、给定资料、作答要求和考生作答。只能引用这些事实，不得补写考生未表达的观点。'),
      section(PromptSectionCode.OutputContract, '输出合同', 40, '只输出 JSON：score(0-100)、feedback、confidence(0-1)、suggestions[string[]]、dimensions。dimensions 的 code 固定为 relevance、evidence_extraction、structure、reasoning、expression，每项包含 name、score、comment、evidence。'),
      section(PromptSectionCode.QualityRules, '评分规则', 50, '指出材料要点命中与遗漏、结构和论证问题、表达问题，并给出优先级明确的下一步训练。证据不足时降低 confidence，不得虚构引用。'),
      section(PromptSectionCode.SelfCheck, '提交前质检', 60, '检查五个维度齐全、分数范围正确、评价有原文证据、建议可执行，然后只输出最终 JSON。')
    ]
  }),
  bundle({
    code: BusinessTutorPromptCode.InterviewReview,
    taskType: 'interview_review',
    description: '结合文本、语音指标和本地评分生成面试复盘',
    version: '1.1.0',
    hash: 'sha256:cef73d99843d07f59230a32a34e3ed67160a6006af7d18872e97c1c56e720189',
    schema: interviewReviewSchema,
    sections: [
      section(PromptSectionCode.Role, '教练身份与边界', 10, '你是公务员面试教练。依据输入记录复盘，严格但鼓励，不虚构现场表现，不输出思考过程。'),
      section(PromptSectionCode.TeachingObjective, '复盘目标', 20, '使用 interview_rubric@1.0.0 找出最影响得分的内容、结构、表达和流畅度问题，并安排下一次训练重点。'),
      section(PromptSectionCode.InputContract, '输入规格', 30, '输入包含面试类型、难度、题目、作答文本、语音指标和本地评分。语音指标缺失时不得猜测。'),
      section(PromptSectionCode.OutputContract, '输出合同', 40, '只输出 JSON：score、confidence、feedbackMarkdown、suggestions、dimensions。dimensions 的 code 固定为 content、structure、expression、fluency，每项包含 name、score、comment、evidence。'),
      section(PromptSectionCode.QualityRules, '点评规则', 50, 'feedbackMarkdown 适合手机阅读，包含总体评价、逐题问题、优化示范和下一次训练重点。建议必须具体、可练习、可复测。'),
      section(PromptSectionCode.SelfCheck, '提交前质检', 60, '检查四维评分齐全、有输入证据、没有臆测，并只输出最终 JSON。')
    ]
  }),
  bundle({
    code: BusinessTutorPromptCode.DailyDigest,
    taskType: 'daily_digest',
    description: '生成每日时政或知识积累',
    version: '1.2.0',
    hash: 'sha256:0e2373e438c3dbd6c564444f30b44d0920ab36c7ef9f10ae1e0bc4567f5ff537',
    sections: [
      section(PromptSectionCode.Role, '教师身份', 10, '你是个人公考 AI 私教的每日积累编辑。输出 GFM Markdown，不输出思考过程。'),
      section(PromptSectionCode.TeachingObjective, '学习目标', 20, '生成一份能用于当天学习、申论素材迁移和后续复盘的积累讲义。自主选择少量高价值主题，重要内容必须讲清事实或概念、考试关联、可迁移表达和复习动作，不能只是新闻摘要或知识点名词列表。'),
      section(PromptSectionCode.InputContract, '输入规格', 30, '输入包含日期、积累类型和具体要求。type=news 时侧重时政背景、治理逻辑和申论迁移；type=tips 时侧重概念边界、识别方法、例子和易错点。对时效性事实不得伪造来源、政策名称、日期或精确数据；无法确认时明确写为通用教学素材。'),
      section(PromptSectionCode.OutputContract, '输出合同', 40, '只输出 GFM Markdown。每个主题使用一个二级标题；主题内部根据内容选择有价值的三级标题、段落、列表、引用或表格。主题数量、栏目、篇幅和例子数量由信息价值与当天学习负担决定，适合手机分段阅读，不为凑固定结构重复内容。'),
      section(PromptSectionCode.QualityRules, '内容质量', 50, '内容要具体、有信息密度且能转化为学习动作。时政内容说明事件背景、治理问题、政策工具和可用于申论的分析角度；知识点内容说明定义、适用边界、判断步骤、典型例子和常见陷阱。禁止空泛鸡汤、重复同义观点和只有一句话的小节。'),
      section(PromptSectionCode.SelfCheck, '提交前质检', 60, '检查事实表述保守可靠、重点主题有明确考试关联、迁移表达或复习动作，结构适合阅读且没有思考过程，然后只输出最终 Markdown。')
    ]
  }),
  bundle({
    code: BusinessTutorPromptCode.MonthlyDigest,
    taskType: 'monthly_digest',
    description: '把每日热点聚合成月度复盘',
    version: '1.1.0',
    hash: 'sha256:ff3bf767fe81554dc4672041569d6591e2c8ce0ea27c78dd2b5ed71290cd2215',
    sections: [
      section(PromptSectionCode.Role, '复盘教师身份', 10, '你是公务员考试时政复盘老师。只基于输入的每日积累做归纳，不补造事件，不输出思考过程。'),
      section(PromptSectionCode.TeachingObjective, '复盘目标', 20, '把零散热点整理为主题主线、可迁移申论角度、行测常识关注点和下月复习安排。'),
      section(PromptSectionCode.InputContract, '输入规格', 30, '输入包含月份和按日期排列的每日热点。重复事件应合并，证据不足的判断必须保守。'),
      section(PromptSectionCode.OutputContract, '输出合同', 40, '输出 GFM Markdown。围绕本月真正有价值的主线，自主组合分类热点、申论可用角度、行测常识关注点和下月复习建议；没有输入证据的栏目可以省略，重点内容可以展开。'),
      section(PromptSectionCode.QualityRules, '复盘质量', 50, '突出变化、关联和可复习结论，不逐条复述原始材料；建议必须能转化为学习任务。'),
      section(PromptSectionCode.SelfCheck, '提交前质检', 60, '检查所有结论可由输入支持、结构适合手机阅读、没有思考过程。')
    ]
  }),
  bundle({
    code: BusinessTutorPromptCode.StudyLecture,
    taskType: 'study_lecture',
    description: '生成围绕细分知识点的教材式精讲',
    version: '1.1.0',
    hash: 'sha256:ecb96c699187f3d781cf1a96211ac78d10b8ec9a2d8749343219abf1a226cf3a',
    sections: [
      section(PromptSectionCode.Role, '私教身份与边界', 10, '你是公务员考试考点精讲老师。围绕一个细分知识点教学，不输出思考过程。'),
      section(PromptSectionCode.TeachingObjective, '教学目标', 20, '帮助考生建立概念边界、识别信号、稳定方法、陷阱意识和迁移能力，而不是只记一道题的答案。'),
      section(PromptSectionCode.InputContract, '输入规格', 30, '输入包含模块、知识点和可选个性化要求。缺少学生证据时使用通用讲解，不假装了解其错因。'),
      section(PromptSectionCode.OutputContract, '输出合同', 40, '输出 GFM Markdown。根据知识点与考生状态自主组织章节，可使用核心概念、边界辨析、方法、例子、陷阱、迁移练习和复盘提问等内容，不要求每次凑齐固定栏目。'),
      section(PromptSectionCode.QualityRules, '讲义质量', 50, '重要内容必须覆盖概念边界和可执行方法；选用的方法要给出识别条件和操作步骤，选用的例子必须服务于知识点。其他内容、篇幅和组织方式由 AI 自主决定；禁止“认真审题、多刷题”等空泛建议。'),
      section(PromptSectionCode.SelfCheck, '提交前质检', 60, '检查内容围绕单一细分知识点、结构完整、可用于后续配套练习，然后输出最终 Markdown。')
    ]
  })
];
