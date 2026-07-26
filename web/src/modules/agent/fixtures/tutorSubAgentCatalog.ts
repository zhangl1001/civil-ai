import { AgentDelegationMode, type SubAgentDefinition } from '../domain/SubAgentRegistry';

/** Specialists are isolated model roles. They do not own long-term memory or write tools. */
export const tutorSubAgentCatalog: readonly SubAgentDefinition[] = [
  {
    code: 'tutor.aptitude_specialist',
    description: '分析行测能力缺口、前置能力和下一步教学候选，返回结构化建议。',
    instructionRef: 'prompt.agent.aptitude-specialist@1',
    skillCodes: ['tutor.daily_coaching'],
    toolCodes: ['student.read_profile', 'learning.review_session'],
    delegationMode: AgentDelegationMode.AsTool,
    maxTurns: 4,
    maxToolCalls: 4
  },
  {
    code: 'tutor.essay_specialist',
    description: '依据申论 rubric 分析作答证据，返回逐维度候选点评。',
    instructionRef: 'prompt.agent.essay-specialist@1',
    skillCodes: [],
    toolCodes: ['student.read_profile', 'learning.review_session'],
    delegationMode: AgentDelegationMode.AsTool,
    maxTurns: 4,
    maxToolCalls: 4
  },
  {
    code: 'tutor.interview_specialist',
    description: '依据面试记录分析内容、结构、表达和节奏，返回复盘候选。',
    instructionRef: 'prompt.agent.interview-specialist@1',
    skillCodes: [],
    toolCodes: ['student.read_profile', 'learning.review_session'],
    delegationMode: AgentDelegationMode.AsTool,
    maxTurns: 4,
    maxToolCalls: 4
  },
  {
    code: 'tutor.content_reviewer',
    description: '独立检查生成内容的结构、答案一致性和教学目标匹配度。',
    instructionRef: 'prompt.agent.content-reviewer@1',
    skillCodes: [],
    toolCodes: [],
    delegationMode: AgentDelegationMode.AsTool,
    maxTurns: 2,
    maxToolCalls: 0
  }
];
