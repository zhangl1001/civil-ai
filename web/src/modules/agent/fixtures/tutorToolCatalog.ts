import { AgentExecutionBudgetTier } from '../domain/AgentExecutionBudget';
import type { AgentSkillManifest } from '../domain/AgentSkillRegistry';
import type { AgentToolDefinition } from '../domain/AgentToolRegistry';
import type { JsonObject } from '@/kernel/public';
import { APTITUDE_MODULE_CODES } from '@/domain/practiceModuleCodes';

const aptitudeModuleCodes = [...APTITUDE_MODULE_CODES];

const emptyObjectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} as const;

const questionVisualSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['svg', 'alt'],
  properties: {
    svg: { type: 'string', minLength: 20, maxLength: 40_000 },
    alt: { type: 'string', minLength: 1, maxLength: 500 },
    viewBox: { type: 'string', maxLength: 100 }
  }
};

const questionImportCandidateSchema: JsonObject = {
  type: 'object',
  description: '一条可审查的原题候选。题干和完整选项是形成可答题草稿的最低结构；答案和解析只按来源原文提供，缺失时保持为空等待确认。',
  additionalProperties: false,
  required: ['id', 'prompt', 'options'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 80, description: '本次扫描内稳定且唯一的候选编号。' },
    materialGroupId: { type: ['string', 'null'], maxLength: 80 },
    material: { type: ['string', 'null'], maxLength: 30_000 },
    prompt: { type: 'string', minLength: 1, maxLength: 12_000, description: '完整小题题干，不包含 A-D 选项；共用材料放入 materialGroups。' },
    visual: questionVisualSchema,
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      description: '来源页面中的完整选项，按原顺序提供。不得只提交题干，也不得补造缺失选项。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 8 },
          text: { type: 'string', minLength: 1, maxLength: 8_000 },
          visual: questionVisualSchema
        }
      }
    },
    correctOptionId: { type: ['string', 'null'], minLength: 1, maxLength: 8, description: '来源明确给出时填写对应选项 ID；未提供答案时为 null，禁止猜测。' },
    difficulty: { type: 'number', minimum: 0, maximum: 1 },
    explanation: {
      type: 'object',
      description: '仅转录来源中真实存在的解析。来源没有解析时省略整个字段，禁止自行生成。',
      additionalProperties: false,
      required: ['knowledgePoint', 'conclusion', 'steps', 'optionAnalysis', 'pitfalls'],
      properties: {
        knowledgePoint: { type: 'string', minLength: 1, maxLength: 200 },
        conclusion: { type: 'string', minLength: 1, maxLength: 8_000 },
        steps: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 4_000 } },
        optionAnalysis: {
          type: 'array',
          minItems: 2,
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['optionId', 'verdict', 'analysis'],
            properties: {
              optionId: { type: 'string', minLength: 1, maxLength: 8 },
              verdict: { type: 'string', enum: ['correct', 'incorrect'] },
              analysis: { type: 'string', minLength: 1, maxLength: 4_000 }
            }
          }
        },
        pitfalls: { type: 'array', maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 2_000 } }
      }
    }
  }
};

export const tutorToolCatalog: readonly AgentToolDefinition[] = [
  { name: 'student.read_profile', description: '读取当前考期、目标、时间约束和可信能力摘要。', inputSchema: emptyObjectSchema, risk: 'read', requiresConfirmation: false, enabledFor: ['tutor_turn', 'teaching_plan'] },
  {
    name: 'workspace.discover',
    description: '像资源目录检索一样，按最小范围列出本地题组、每日积累或考点讲义的摘要和资源 ID，不读取正文。需要确认“有没有、有哪些、最近生成了什么”时先调用。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['resourceType', 'scope'],
      properties: {
        resourceType: { type: 'string', enum: ['question_sets', 'digests', 'lectures'] },
        scope: { type: 'string', enum: ['today', 'recent', 'all'] },
        keyword: { type: 'string', maxLength: 80 },
        limit: { type: 'number', minimum: 1, maximum: 12 }
      }
    },
    risk: 'read',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn', 'teaching_plan', 'review']
  },
  {
    name: 'task.read_status',
    description: '读取本地持久化任务的真实状态。已知 taskId 时精确查询；否则按 active、today、recent 或 all 查询。异步写工具返回 taskId 后必须调用本工具核验受理状态。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        taskId: { type: 'string', minLength: 1, maxLength: 100 },
        scope: { type: 'string', enum: ['active', 'today', 'recent', 'all'] },
        intent: {
          type: 'string',
          enum: ['daily', 'practice', 'essayGrade', 'mock', 'redo', 'digest', 'monthlyDigest', 'study', 'interviewReview', 'trueQuestionResearch']
        },
        limit: { type: 'number', minimum: 1, maximum: 12 }
      }
    },
    risk: 'read',
    role: 'completion_verifier',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn', 'teaching_plan', 'review']
  },
  {
    name: 'tutor.read_daily_context',
    description: '按硬限制读取今天的计划、优先能力、到期复习、近期真题证据、进行中学习主线和最近教学结论。用户问今天学什么、下一步做什么或当前训练是否有效时优先调用；不得用会话记忆替代本地事实。',
    inputSchema: emptyObjectSchema,
    risk: 'read',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn', 'teaching_plan', 'review']
  },
  {
    name: 'practice.read_library',
    description: '检索当前备考档案的本地题组目录和生成状态，不读取题目正文。询问题库是否有数据时用 scope=all；明确询问今天、最近七天或执行中时再用对应范围。结果会同时说明整个题库和当前筛选的数量，不能把筛选为空误判为题库为空。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['scope'],
      properties: {
        scope: { type: 'string', enum: ['today', 'recent', 'active', 'all'] },
        entryMode: { type: 'string', enum: ['all', 'tutor', 'self'] },
        module: { type: 'string', maxLength: 40 },
        capabilityKeyword: { type: 'string', maxLength: 40 },
        limit: { type: 'number', minimum: 1, maximum: 10 }
      }
    },
    risk: 'read',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn', 'teaching_plan', 'review']
  },
  {
    name: 'practice.read_question_set',
    description: '在 practice.read_library 返回 questionSetId 后，按需读取一个题组的概览、讲义或一页题目。禁止猜测 ID；读取题目时每次最多 5 道并使用 offset 翻页，不主动向用户泄露答案。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['questionSetId', 'section'],
      properties: {
        questionSetId: { type: 'string', minLength: 1, maxLength: 100 },
        section: { type: 'string', enum: ['overview', 'questions', 'lecture'] },
        offset: { type: 'number', minimum: 0 },
        limit: { type: 'number', minimum: 1, maximum: 5 }
      }
    },
    risk: 'read',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn', 'teaching_plan', 'review']
  },
  {
    name: 'file.read_text',
    description: '按片段读取用户已经导入当前备考档案的文本、PDF 提取结果或图片 OCR 结果。只在用户消息提供本地路径后调用；长文件按需续读，不得一次加载无关全文。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 240 },
        offset: { type: 'number', minimum: 0 },
        maxChars: { type: 'number', minimum: 2_000, maximum: 24_000 }
      }
    },
    risk: 'read',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  },
  {
    name: 'question_bank.scan',
    description: '把用户明确提供的真题或外部题目提取为待确认草稿。只校验可渲染结构、答案引用和来源身份；原文没有答案、解析或来源时允许缺失并进入待确认，严禁补造。能力节点不明确时先询问用户。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['capability', 'module', 'sourceType', 'importMethod', 'sourceMetadata', 'questions'],
      properties: {
        capability: {
          type: 'string',
          minLength: 1,
          maxLength: 100,
          description: '填写一个明确的课程能力节点名称或 code，例如“类比推理”或 aptitude.judgment.analogy；不要把“行测-判断推理”等多层级拼成一个值。'
        },
        module: {
          type: 'string',
          minLength: 1,
          maxLength: 80,
          description: '题组展示模块，例如“判断推理”；具体考点放 capability。'
        },
        sourceType: { type: 'string', enum: ['official', 'imported', 'user_created'] },
        importMethod: { type: 'string', enum: ['manual_text', 'structured_file', 'document_scan', 'image_ocr', 'web_research'] },
        sourceMetadata: {
          type: 'object',
          additionalProperties: false,
          properties: {
            provider: { type: 'string', maxLength: 100 },
            examType: { type: 'string', maxLength: 100 },
            examYear: { type: 'number', minimum: 1990, maximum: 2200 },
            province: { type: 'string', maxLength: 100 },
            examBatch: { type: 'string', maxLength: 100 },
            paperName: { type: 'string', maxLength: 240 },
            sectionName: { type: 'string', maxLength: 160 },
            sourceVersion: { type: 'string', maxLength: 40 },
            sourceUrl: { type: 'string', maxLength: 2_000 },
            sourceDomain: { type: 'string', maxLength: 240 },
            searchQuery: { type: 'string', maxLength: 300 },
            fetchedAt: { type: 'number', minimum: 0 }
          }
        },
        materialGroups: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'markdown'],
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 80 },
              markdown: { type: 'string', minLength: 1, maxLength: 30_000 }
            }
          }
        },
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: questionImportCandidateSchema
        }
      }
    },
    risk: 'write',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  },
  {
    name: 'question_bank.confirm',
    description: '仅在用户明确确认扫描结果后确认题库导入草稿；可替换校验失败的候选题或拒绝无法确定的候选题。确认不会发布正式题组。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['draftId', 'expectedVersion'],
      properties: {
        draftId: { type: 'string', minLength: 1, maxLength: 100 },
        expectedVersion: { type: 'number', minimum: 1 },
        replacements: {
          type: 'array',
          maxItems: 50,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['candidateId', 'question'],
            properties: {
              candidateId: { type: 'string', minLength: 1, maxLength: 100 },
              question: questionImportCandidateSchema
            }
          }
        },
        rejectedCandidateIds: {
          type: 'array',
          maxItems: 50,
          items: { type: 'string', minLength: 1, maxLength: 100 }
        }
      }
    },
    risk: 'write',
    requiresConfirmation: true,
    enabledFor: ['tutor_turn']
  },
  {
    name: 'question_bank.repair',
    description: '根据扫描结果和原始证据，自动修正未发布草稿中的字段错位、题号边界或选项结构；只更新草稿，不代表用户确认，也不会发布正式题库。来源缺少答案或关键身份时不得猜测，保留待确认。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['draftId', 'expectedVersion', 'replacements'],
      properties: {
        draftId: { type: 'string', minLength: 1, maxLength: 100 },
        expectedVersion: { type: 'number', minimum: 1 },
        replacements: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['candidateId', 'question'],
            properties: {
              candidateId: { type: 'string', minLength: 1, maxLength: 100 },
              question: questionImportCandidateSchema
            }
          }
        }
      }
    },
    risk: 'write',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  },
  {
    name: 'question_bank.resume',
    description: '恢复当前对话最近一个待确认或已确认的题目导入草稿摘要，只读取状态和问题清单，不读取题目正文。',
    inputSchema: emptyObjectSchema,
    risk: 'read',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  },
  {
    name: 'question_bank.publish',
    description: '把已经确认且结构校验通过的导入草稿原子发布为正式题组。执行前必须再次获得用户确认。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['draftId', 'expectedVersion'],
      properties: {
        draftId: { type: 'string', minLength: 1, maxLength: 100 },
        expectedVersion: { type: 'number', minimum: 1 }
      }
    },
    risk: 'write',
    requiresConfirmation: true,
    enabledFor: ['tutor_turn']
  },
  { name: 'teaching.request_practice', description: '为当前能力主线创建结构化练习生成任务。module 使用统一行测模块 code。', inputSchema: { type:'object', additionalProperties:false, required:['module'], properties:{ module:{type:'string',enum: aptitudeModuleCodes}, knowledgePoint:{type:'string'}, questionCount:{type:'number',minimum:1,maximum:25}, difficulty:{type:'string',enum:['基础','标准','进阶']} } }, risk: 'write', requiresConfirmation: false, enabledFor: ['tutor_turn', 'teaching_plan'] },
  { name: 'learning.review_session', description: '读取已完成练习的判分、错因候选和下一步建议。', inputSchema: { type:'object', additionalProperties:false, required:['sessionId'], properties:{sessionId:{type:'string'}} }, risk: 'read', requiresConfirmation: false, enabledFor: ['tutor_turn', 'review'] },
  { name: 'planning.propose_daily_plan', description: '根据到期复习、能力轨迹和可用时间生成本地计划提案。', inputSchema: emptyObjectSchema, risk: 'read', requiresConfirmation: false, enabledFor: ['tutor_turn', 'teaching_plan'] },
  { name: 'candidate.change_target', description: '修改目标分数。执行前必须由用户明确确认。', inputSchema: { type:'object', additionalProperties:false, required:['subject','targetScore'], properties:{subject:{type:'string',enum:['aptitude','essay','interview']},targetScore:{type:'number',minimum:0,maximum:100}} }, risk: 'write', requiresConfirmation: true, enabledFor: ['tutor_turn'] }
];

const factualValidator = {
  name: 'agent.factual-grounding',
  description: '涉及本地业务状态的结论必须来自本轮工具结果。'
} as const;

const completionValidator = {
  name: 'agent.no-false-completion',
  description: 'Skill 加载、任务受理和业务完成必须明确区分。'
} as const;

export const tutorSkillCatalog: readonly AgentSkillManifest[] = [
  defineSkill({
    name: 'tutor.daily_coaching',
    description: '基于今日计划、能力证据和到期复习安排下一步学习。',
    allowedTools: ['system.read_clock', 'tutor.read_daily_context', 'workspace.discover', 'task.read_status', 'planning.propose_daily_plan', 'teaching.request_practice'],
    contextBudgetTokens: 1_000,
    workflow: {
      name: '今日私教决策',
      description: '先读取当天事实，再决定解释计划、提出调整或创建训练。',
      steps: [
        { name: '读取事实', description: '按需调用 system.read_clock 获取当前日历，再调用 tutor.read_daily_context 获取今日计划、到期复习和能力主线。不要用对话中的日期替代设备事实。' },
        { name: '形成决策', description: '信息足够时直接解释；需要重排时调用 planning.propose_daily_plan。' },
        { name: '执行训练', description: '用户明确要开始训练时调用 teaching.request_practice，并用 task.read_status 核验任务是否真实受理。' }
      ],
      completionCriteria: ['已基于本轮本地事实回答；或训练任务已经真实受理；或已明确询问缺失信息。'],
      failureRecovery: ['读取失败时说明无法取得哪类事实，不得用历史对话猜测。', '训练创建失败时保留原计划并给出可重试动作。']
    },
    promptChapters: [{
      name: 'tutor.daily-decision',
      title: '每日教学决策',
      content: '优先闭环到期复习和当前薄弱能力；题量、难度和训练形式根据本轮事实决定，不机械固定。'
    }],
    resources: [{
      name: 'task-lifecycle',
      description: '异步学习任务的状态解释。',
      content: '任务 ID 产生表示已受理；只有任务状态完成且结果已提交，才能表述为内容已生成。'
    }],
    validators: [factualValidator, completionValidator]
  }),
  defineSkill({
    name: 'tutor.practice_library',
    description: '按最小范围核对题库、题组和已完成练习的真实状态。',
    allowedTools: ['workspace.discover', 'practice.read_library', 'practice.read_question_set', 'learning.review_session'],
    contextBudgetTokens: 900,
    workflow: {
      name: '题库事实查询',
      description: '从目录摘要逐步下钻到题组或练习复盘，避免读取无关题目正文。',
      steps: [
        { name: '读取目录', description: '先调用 practice.read_library，并使用用户要求的最小时间范围。' },
        { name: '按需下钻', description: '用户明确某套题时调用 practice.read_question_set；询问成绩或错因时调用 learning.review_session。' },
        { name: '回答结论', description: '区分全部题库数量、筛选结果、生成中任务和已完成练习。' }
      ],
      completionCriteria: ['结论引用本轮读取结果，并准确区分题组存在、练习状态和筛选范围。'],
      failureRecovery: ['范围不明确时先询问题组或日期。', '读取为空时说明查询范围，不得直接断言整个题库为空。']
    },
    promptChapters: [{
      name: 'practice.query-scope',
      title: '题库查询范围',
      content: '默认先读目录摘要；只有用户需要具体题目、成绩或错因时才读取对应资源。'
    }],
    validators: [factualValidator]
  }),
  defineSkill({
    name: 'tutor.objective_practice',
    description: '围绕用户明确的行测模块、知识点和题量创建针对性训练。',
    allowedTools: ['student.read_profile', 'task.read_status', 'teaching.request_practice', 'learning.review_session'],
    contextBudgetTokens: 900,
    workflow: {
      name: '行测训练创建',
      description: '确认训练范围后创建任务，并在后续读取真实练习结果。',
      steps: [
        { name: '确认范围', description: '自主刷题使用用户条件；私教训练必要时读取 student.read_profile。' },
        { name: '创建训练', description: '调用 teaching.request_practice，传递明确模块、知识点、题量和难度，再用 task.read_status 核验真实受理状态。' },
        { name: '复盘衔接', description: '已有完成记录且用户要求分析时调用 learning.review_session。' }
      ],
      completionCriteria: ['创建场景必须获得真实任务标识；分析场景必须读取真实练习结果；信息不足时明确追问。'],
      failureRecovery: ['模块、题量或对象不明确时不猜测。', '创建失败时说明可重试条件，不得伪造题组。']
    },
    promptChapters: [{
      name: 'practice.personalization',
      title: '个性化训练边界',
      content: '私教训练以能力证据为依据，自主刷题以用户条件为依据；两种来源不得混淆。'
    }],
    validators: [factualValidator, completionValidator]
  }),
  defineSkill({
    name: 'tutor.goal_management',
    description: '读取、讨论并在用户确认后修改备考目标分数。',
    allowedTools: ['student.read_profile', 'candidate.change_target'],
    contextBudgetTokens: 700,
    workflow: {
      name: '目标调整',
      description: '先读取当前目标，再解释影响，最后通过确认工具修改。',
      steps: [
        { name: '读取现状', description: '调用 student.read_profile 获取当前基线、目标和考试周期。' },
        { name: '确认变更', description: '明确科目和目标分，并向用户说明对计划的影响。' },
        { name: '执行修改', description: '用户确认后调用 candidate.change_target。' }
      ],
      completionCriteria: ['只在工具成功后确认目标已修改；未确认时停留在建议或确认阶段。'],
      failureRecovery: ['缺少当前考期时提示先建档。', '修改冲突时重新读取最新目标后再请求确认。']
    },
    promptChapters: [{
      name: 'goal.change-policy',
      title: '目标调整规则',
      content: '目标属于高影响业务事实，模型只能提出建议，最终写入必须经过用户明确确认。'
    }],
    validators: [factualValidator, completionValidator]
  }),
  defineSkill({
    name: 'tutor.question_bank_ingestion',
    description: '读取用户资料，并通过扫描、自动修正、确认和发布工作流导入真题或外部题目。',
    allowedTools: ['file.read_text', 'question_bank.scan', 'question_bank.repair', 'question_bank.resume', 'question_bank.confirm', 'question_bank.publish'],
    contextBudgetTokens: 1_600,
    executionBudget: AgentExecutionBudgetTier.LongRunning,
    workflow: {
      name: '题库导入',
      description: '原始资料先形成可审查草稿，用户确认后才能原子发布到正式题库。',
      steps: [
        { name: '读取来源', description: '文本文件按需调用 file.read_text；图片附件直接使用本轮多模态内容。' },
        { name: '扫描草稿', description: '调用 question_bank.scan 生成候选题和结构问题清单。' },
        { name: '自动修正', description: '扫描发现字段错位、题号边界或选项结构问题时，根据原文和问题清单调用 question_bank.repair；不要求用户手工改格式，也不把修正当成发布确认。' },
        { name: '恢复或确认', description: '续办先调用 question_bank.resume；用户确认后调用 question_bank.confirm。' },
        { name: '正式发布', description: '仅对已确认且校验通过的草稿调用 question_bank.publish。' }
      ],
      completionCriteria: ['扫描、确认、发布的状态分别来自对应工具结果；不得跨过用户确认；发布成功后才能说已入正式题库。'],
      failureRecovery: ['扫描出现字段错位、题号边界或选项结构问题时，先用 question_bank.repair 修复对应候选并重新观察结果。', '原文缺失答案或来源时保留为空并进入待确认，不得补造。', '草稿不存在时要求重新提供原文件。', '结构问题只修复失败候选，不虚构整套导入成功。']
    },
    promptChapters: [{
      name: 'question-bank.provenance',
      title: '来源与真实性',
      content: '官方、导入和用户创建来源必须区分；网络候选未经核验不得标记为官方真题。'
    }],
    resources: [{
      name: 'import-state-machine',
      description: '题库导入状态顺序。',
      content: 'source_ready -> scanned -> waiting_confirmation -> confirmed -> published；任何一步失败都保留可恢复草稿。'
    }],
    validators: [
      factualValidator,
      completionValidator,
      { name: 'question-bank.renderable-structure', description: '只阻断无法答题、无法解析或答案引用错误的结构问题。' }
    ]
  })
];

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
