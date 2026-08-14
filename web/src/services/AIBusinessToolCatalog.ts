import type { AgentToolImpact } from '@/modules/agent/public';

export type AIBusinessToolName =
  | 'generate_practice'
  | 'generate_mock'
  | 'generate_essay'
  | 'redo_wrongbook'
  | 'generate_digest'
  | 'generate_monthly_digest'
  | 'research_true_questions'
  | 'grade_essay'
  | 'review_interview';

export interface AIBusinessToolDefinition {
  name: AIBusinessToolName;
  description: string;
  parameters: AIBusinessToolParameterSchema;
  impact: AgentToolImpact;
}

export interface AIBusinessToolParameter {
  type: 'string' | 'number' | 'boolean';
  description: string;
  enum?: string[];
  default?: string | number | boolean;
  minimum?: number;
  maximum?: number;
}

export interface AIBusinessToolParameterSchema {
  type: 'object';
  required: string[];
  properties: Record<string, AIBusinessToolParameter>;
}

export interface AIBusinessToolCall {
  name: AIBusinessToolName;
  arguments: Record<string, unknown>;
}

export interface AIBusinessToolResult {
  reply: string;
  taskId?: string;
}

export interface AIBusinessToolExecuteMeta {
  sessionId?: string;
  idempotencyKey?: string;
}

export const AI_BUSINESS_TOOLS: readonly AIBusinessToolDefinition[] = [
  {
    name: 'generate_practice',
    description: '生成当前考试包的客观题专项练习，适用于用户要求按模块、考点、题量刷题或出题。',
    impact: generationImpact({ argument: 'questionCount', value: 25 }),
    parameters: {
      type: 'object',
      required: [],
      properties: {
        module: {
          type: 'string',
          description: '当前考试大纲的模块 code。不要自行拼接名称；填错会被拒绝并返回可用取值。'
        },
        knowledgePoint: { type: 'string', description: '用户明确指定的细分知识点；未指定时省略，由学习档案选择' },
        questionCount: { type: 'number', description: '题量', default: 10, minimum: 1, maximum: 120 },
        difficulty: { type: 'string', description: '难度', enum: ['基础', '标准', '进阶'], default: '标准' }
      }
    }
  },
  {
    name: 'generate_mock',
    description: '生成当前考试包的客观题模考试卷，适用于用户要求模考、套卷、模拟考试。',
    impact: highGenerationImpact(),
    parameters: {
      type: 'object',
      required: [],
      properties: {
        questionCount: { type: 'number', description: '题量', default: 120, minimum: 20, maximum: 120 }
      }
    }
  },
  {
    name: 'generate_essay',
    description: '生成申论练习题或申论模考材料，适用于用户要求申论出题。',
    impact: generationImpact({ argument: 'questionCount', value: 1 }),
    parameters: {
      type: 'object',
      required: [],
      properties: {
        essayTopic: { type: 'string', description: '主观题题型。省略时使用考试包声明的默认短答题型。' },
        essayType: { type: 'string', description: '题型长度', enum: ['short', 'long'], default: 'short' },
        questionCount: { type: 'number', description: '小问数量', default: 1, minimum: 1, maximum: 3 }
      }
    }
  },
  {
    name: 'redo_wrongbook',
    description: '生成错题重练，适用于用户要求错题重做、错题复习、错题变式训练。',
    impact: generationImpact({ argument: 'questionCount', value: 20 }),
    parameters: {
      type: 'object',
      required: [],
      properties: {
        module: {
          type: 'string',
          description: '当前考试大纲的错题模块 code。不要自行拼接名称；填错会被拒绝并返回可用取值。'
        },
        knowledgePoint: { type: 'string', description: '用户明确指定的错题知识点；未指定时根据能力轨迹选择' },
        questionCount: { type: 'number', description: '题量', default: 10, minimum: 1, maximum: 60 }
      }
    }
  },
  {
    name: 'generate_digest',
    description: '生成每日积累，包含每日热点或每日知识点。',
    impact: lowGenerationImpact(),
    parameters: {
      type: 'object',
      required: [],
      properties: {
        digestTab: { type: 'string', description: '积累类型，news 为时政热点，tips 为知识点', enum: ['news', 'tips'], default: 'news' }
      }
    }
  },
  {
    name: 'generate_monthly_digest',
    description: '生成本月时政月报或月度复盘。',
    impact: highGenerationImpact(),
    parameters: { type: 'object', required: [], properties: {} }
  },
  {
    name: 'research_true_questions',
    description: '创建独立的联网真题研究任务。任务会自行调整检索策略、核验网页并生成待确认草稿；适用于用户要求联网找真题或把公开真题加入题库。',
    impact: {
      cost: 'medium',
      network: 'broad',
      persistence: 'reversible'
    },
    parameters: {
      type: 'object',
      required: ['scope'],
      properties: {
        scope: { type: 'string', description: '年份、地区、考试类型、模块或考点组成的明确范围' },
        maxQuestions: { type: 'number', description: '本轮最多整理的可核验题目数', default: 5, minimum: 1, maximum: 10 }
      }
    }
  },
  {
    name: 'grade_essay',
    description: '申论批改入口说明。需要用户先在申论页面填写作答内容。',
    impact: lowGenerationImpact(),
    parameters: { type: 'object', required: [], properties: {} }
  },
  {
    name: 'review_interview',
    description: '面试深度点评入口说明。需要用户先完成一次面试模拟。',
    impact: lowGenerationImpact(),
    parameters: { type: 'object', required: [], properties: {} }
  }
];

function lowGenerationImpact(): AgentToolImpact {
  return { cost: 'low', network: 'none', persistence: 'reversible' };
}

function generationImpact(confirmAbove: NonNullable<AgentToolImpact['confirmAbove']>): AgentToolImpact {
  return { cost: 'medium', network: 'none', persistence: 'reversible', confirmAbove };
}

function highGenerationImpact(): AgentToolImpact {
  return { cost: 'high', network: 'none', persistence: 'reversible' };
}
