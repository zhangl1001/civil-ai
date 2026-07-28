import type { AgentSkillDefinition, AgentToolDefinition } from '../domain/AgentToolRegistry';
import type { JsonObject } from '@/kernel/public';

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
  additionalProperties: false,
  required: ['id', 'prompt', 'options'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 80 },
    materialGroupId: { type: ['string', 'null'], maxLength: 80 },
    material: { type: ['string', 'null'], maxLength: 30_000 },
    prompt: { type: 'string', minLength: 1, maxLength: 12_000 },
    visual: questionVisualSchema,
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
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
    correctOptionId: { type: ['string', 'null'], minLength: 1, maxLength: 8 },
    difficulty: { type: 'number', minimum: 0, maximum: 1 },
    explanation: {
      type: 'object',
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
  { code: 'student.read_profile', description: '读取当前考期、目标、时间约束和可信能力摘要。', inputSchema: emptyObjectSchema, risk: 'read', requiresConfirmation: false, enabledFor: ['tutor_turn', 'teaching_plan'] },
  {
    code: 'tutor.read_daily_context',
    description: '按硬限制读取今天的计划、优先能力、到期复习、近期真题证据、进行中学习主线和最近教学结论。用户问今天学什么、下一步做什么或当前训练是否有效时优先调用；不得用会话记忆替代本地事实。',
    inputSchema: emptyObjectSchema,
    risk: 'read',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn', 'teaching_plan', 'review']
  },
  {
    code: 'practice.read_library',
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
    code: 'practice.read_question_set',
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
    code: 'file.read_text',
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
    code: 'question_bank.scan',
    description: '把用户明确提供的真题或外部题目提取为待确认草稿。只校验可渲染结构、答案引用和来源身份；原文没有答案、解析或来源时允许缺失并进入待确认，严禁补造。能力节点不明确时先询问用户。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['capability', 'module', 'sourceType', 'importMethod', 'sourceMetadata', 'questions'],
      properties: {
        capability: { type: 'string', minLength: 1, maxLength: 100 },
        module: { type: 'string', minLength: 1, maxLength: 80 },
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
    code: 'question_bank.confirm',
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
    code: 'question_bank.resume',
    description: '恢复当前对话最近一个待确认或已确认的题目导入草稿摘要，只读取状态和问题清单，不读取题目正文。',
    inputSchema: emptyObjectSchema,
    risk: 'read',
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  },
  {
    code: 'question_bank.publish',
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
  { code: 'teaching.request_practice', description: '为当前能力主线创建结构化练习生成任务。', inputSchema: { type:'object', additionalProperties:false, required:['module'], properties:{ module:{type:'string'}, knowledgePoint:{type:'string'}, questionCount:{type:'number',minimum:1,maximum:25}, difficulty:{type:'string',enum:['基础','标准','进阶']} } }, risk: 'write', requiresConfirmation: false, enabledFor: ['tutor_turn', 'teaching_plan'] },
  { code: 'learning.review_session', description: '读取已完成练习的判分、错因候选和下一步建议。', inputSchema: { type:'object', additionalProperties:false, required:['sessionId'], properties:{sessionId:{type:'string'}} }, risk: 'read', requiresConfirmation: false, enabledFor: ['tutor_turn', 'review'] },
  { code: 'planning.propose_daily_plan', description: '根据到期复习、能力轨迹和可用时间生成本地计划提案。', inputSchema: emptyObjectSchema, risk: 'read', requiresConfirmation: false, enabledFor: ['tutor_turn', 'teaching_plan'] },
  { code: 'candidate.change_target', description: '修改目标分数。执行前必须由用户明确确认。', inputSchema: { type:'object', additionalProperties:false, required:['subject','targetScore'], properties:{subject:{type:'string',enum:['aptitude','essay','interview']},targetScore:{type:'number',minimum:0,maximum:100}} }, risk: 'write', requiresConfirmation: true, enabledFor: ['tutor_turn'] }
];

export const tutorSkillCatalog: readonly AgentSkillDefinition[] = [
  { code: 'tutor.daily_coaching', description: '基于今日计划、能力证据和到期复习安排下一步学习。', toolCodes: ['tutor.read_daily_context', 'planning.propose_daily_plan', 'teaching.request_practice'], contextBudgetTokens: 1_000 },
  { code: 'tutor.practice_library', description: '按最小范围核对题库、题组和已完成练习的真实状态。', toolCodes: ['practice.read_library', 'practice.read_question_set', 'learning.review_session'], contextBudgetTokens: 900 },
  { code: 'tutor.objective_practice', description: '围绕用户明确的行测模块、知识点和题量创建针对性训练。', toolCodes: ['student.read_profile', 'teaching.request_practice', 'learning.review_session'], contextBudgetTokens: 900 },
  { code: 'tutor.goal_management', description: '讨论和确认目标分数调整。', toolCodes: ['student.read_profile', 'candidate.change_target'], contextBudgetTokens: 700 },
  { code: 'tutor.question_bank_ingestion', description: '按需读取用户资料，扫描、恢复、确认并发布真题或外部题目。', toolCodes: ['file.read_text', 'question_bank.scan', 'question_bank.resume', 'question_bank.confirm', 'question_bank.publish'], contextBudgetTokens: 1_600 }
];
