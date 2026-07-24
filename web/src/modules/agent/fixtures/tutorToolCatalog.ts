import type { AgentSkillDefinition, AgentToolDefinition } from '../domain/AgentToolRegistry';

export const tutorToolCatalog: readonly AgentToolDefinition[] = [
  { code: 'student.read_profile', description: '读取当前考期、目标、时间约束和可信能力摘要。', inputSchema: {}, risk: 'read', requiresConfirmation: false, enabledFor: ['tutor_turn', 'teaching_plan'] },
  { code: 'teaching.request_practice', description: '为当前能力主线创建结构化练习生成任务。', inputSchema: {}, risk: 'write', requiresConfirmation: false, enabledFor: ['tutor_turn', 'teaching_plan'] },
  { code: 'learning.review_session', description: '读取已完成练习的判分、错因候选和下一步建议。', inputSchema: {}, risk: 'read', requiresConfirmation: false, enabledFor: ['tutor_turn', 'review'] },
  { code: 'planning.propose_daily_plan', description: '根据到期复习、能力轨迹和可用时间生成本地计划提案。', inputSchema: {}, risk: 'read', requiresConfirmation: false, enabledFor: ['tutor_turn', 'teaching_plan'] },
  { code: 'candidate.change_target', description: '修改目标分数。', inputSchema: {}, risk: 'write', requiresConfirmation: true, enabledFor: ['tutor_turn'] }
];

export const tutorSkillCatalog: readonly AgentSkillDefinition[] = [
  { code: 'tutor.daily_coaching', description: '解释当天训练安排，并根据证据引导下一步。', toolCodes: ['student.read_profile', 'planning.propose_daily_plan', 'teaching.request_practice', 'learning.review_session'], contextBudgetTokens: 1_200 },
  { code: 'tutor.goal_management', description: '讨论和确认目标分数调整。', toolCodes: ['student.read_profile', 'candidate.change_target'], contextBudgetTokens: 700 }
];
