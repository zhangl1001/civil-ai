import type { AgentSkillDefinition, AgentToolDefinition } from '../domain/AgentToolRegistry';

const emptyObjectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} as const;

export const tutorToolCatalog: readonly AgentToolDefinition[] = [
  { code: 'student.read_profile', description: '读取当前考期、目标、时间约束和可信能力摘要。', inputSchema: emptyObjectSchema, risk: 'read', requiresConfirmation: false, enabledFor: ['tutor_turn', 'teaching_plan'] },
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
  { code: 'file.read_text', description: '读取用户已经导入当前备考档案的文本文件。只在用户消息提供本地路径后调用。', inputSchema: { type:'object', additionalProperties:false, required:['path'], properties:{path:{type:'string',minLength:1,maxLength:240}} }, risk: 'read', requiresConfirmation: false, enabledFor: ['tutor_turn'] },
  { code: 'teaching.request_practice', description: '为当前能力主线创建结构化练习生成任务。', inputSchema: { type:'object', additionalProperties:false, required:['module'], properties:{ module:{type:'string'}, knowledgePoint:{type:'string'}, questionCount:{type:'number',minimum:1,maximum:25}, difficulty:{type:'string',enum:['基础','标准','进阶']} } }, risk: 'write', requiresConfirmation: false, enabledFor: ['tutor_turn', 'teaching_plan'] },
  { code: 'learning.review_session', description: '读取已完成练习的判分、错因候选和下一步建议。', inputSchema: { type:'object', additionalProperties:false, required:['sessionId'], properties:{sessionId:{type:'string'}} }, risk: 'read', requiresConfirmation: false, enabledFor: ['tutor_turn', 'review'] },
  { code: 'planning.propose_daily_plan', description: '根据到期复习、能力轨迹和可用时间生成本地计划提案。', inputSchema: emptyObjectSchema, risk: 'read', requiresConfirmation: false, enabledFor: ['tutor_turn', 'teaching_plan'] },
  { code: 'candidate.change_target', description: '修改目标分数。执行前必须由用户明确确认。', inputSchema: { type:'object', additionalProperties:false, required:['subject','targetScore'], properties:{subject:{type:'string',enum:['aptitude','essay','interview']},targetScore:{type:'number',minimum:0,maximum:100}} }, risk: 'write', requiresConfirmation: true, enabledFor: ['tutor_turn'] }
];

export const tutorSkillCatalog: readonly AgentSkillDefinition[] = [
  { code: 'tutor.daily_coaching', description: '解释当天训练安排，并根据证据引导下一步。', toolCodes: ['student.read_profile', 'practice.read_library', 'practice.read_question_set', 'planning.propose_daily_plan', 'teaching.request_practice', 'learning.review_session'], contextBudgetTokens: 1_200 },
  { code: 'tutor.goal_management', description: '讨论和确认目标分数调整。', toolCodes: ['student.read_profile', 'candidate.change_target'], contextBudgetTokens: 700 }
];
