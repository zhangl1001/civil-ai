import { digestService } from '@/services/DigestService';
import { essayFlowService } from '@/services/EssayFlowService';
import { examFlowService } from '@/services/ExamFlowService';
import { monthlyDigestService } from '@/services/MonthlyDigestService';
import { practiceFlowService, type PracticeStartContext } from '@/services/PracticeFlowService';
import { taskStore } from '@/tasks/TaskStore';
import type { EnqueueResult } from '@/tasks/taskTypes';

export type AIBusinessToolName =
  | 'generate_practice'
  | 'generate_mock'
  | 'generate_essay'
  | 'redo_wrongbook'
  | 'generate_digest'
  | 'generate_monthly_digest'
  | 'grade_essay'
  | 'review_interview';

export interface AIBusinessToolDefinition {
  name: AIBusinessToolName;
  description: string;
  parameters: AIBusinessToolParameterSchema;
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
}

export const AI_BUSINESS_TOOLS: AIBusinessToolDefinition[] = [
  {
    name: 'generate_practice',
    description: '生成行测专项练习题，适用于用户要求按模块、考点、题量刷题或出题。',
    parameters: {
      type: 'object',
      required: ['module'],
      properties: {
        module: { type: 'string', description: '行测模块', enum: ['资料分析', '判断推理', '言语理解', '数量关系', '常识判断'] },
        questionCount: { type: 'number', description: '题量', default: 10, minimum: 1, maximum: 120 },
        difficulty: { type: 'string', description: '难度', enum: ['基础', '标准', '进阶'], default: '标准' }
      }
    }
  },
  {
    name: 'generate_mock',
    description: '生成行测模考试卷，适用于用户要求模考、套卷、模拟考试。',
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
    parameters: {
      type: 'object',
      required: [],
      properties: {
        essayTopic: { type: 'string', description: '申论题型或主题', enum: ['归纳概括', '综合分析', '提出对策', '贯彻执行', '申发论述'], default: '申论小题' },
        essayType: { type: 'string', description: '题型长度', enum: ['short', 'long'], default: 'short' },
        questionCount: { type: 'number', description: '小问数量', default: 1, minimum: 1, maximum: 3 }
      }
    }
  },
  {
    name: 'redo_wrongbook',
    description: '生成错题重练，适用于用户要求错题重做、错题复习、错题变式训练。',
    parameters: {
      type: 'object',
      required: [],
      properties: {
        module: { type: 'string', description: '错题模块', enum: ['资料分析', '判断推理', '言语理解', '数量关系', '常识判断'] },
        questionCount: { type: 'number', description: '题量', default: 10, minimum: 1, maximum: 60 }
      }
    }
  },
  {
    name: 'generate_digest',
    description: '生成每日积累，包含每日热点或每日知识点。',
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
    parameters: { type: 'object', required: [], properties: {} }
  },
  {
    name: 'grade_essay',
    description: '申论批改入口说明。需要用户先在申论页面填写作答内容。',
    parameters: { type: 'object', required: [], properties: {} }
  },
  {
    name: 'review_interview',
    description: '面试深度点评入口说明。需要用户先完成一次面试模拟。',
    parameters: { type: 'object', required: [], properties: {} }
  }
];

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function taskReply(result: EnqueueResult, label: string): string {
  return result.reused
    ? `${label}已经在任务栏里执行中，我不会重复派发。`
    : `已开始${label}，你可以在任务栏查看进度，完成后点击任务进入对应页面。`;
}

export class AIBusinessTools {
  definitions(): AIBusinessToolDefinition[] {
    return AI_BUSINESS_TOOLS;
  }

  async execute(call: AIBusinessToolCall, meta: AIBusinessToolExecuteMeta = {}): Promise<AIBusinessToolResult> {
    const args = call.arguments || {};
    if (call.name === 'generate_practice' || call.name === 'redo_wrongbook') {
      const mode = call.name === 'redo_wrongbook' ? 'review' : 'practice';
      const context: PracticeStartContext = practiceFlowService.writeStartContext({
        module: asString(args.module) || '资料分析',
        date: today(),
        mode,
        source: 'practice-center',
        questionCount: asNumber(args.questionCount, 10),
        difficulty: asString(args.difficulty) || undefined,
        needsGeneration: true
      });
      const result = await practiceFlowService.enqueueGeneration(context);
      await attachSessionToTask(result, meta.sessionId);
      return {
        taskId: result.task.id,
        reply: taskReply(result, mode === 'review' ? '错题重练' : `${context.module}练习`)
      };
    }

    if (call.name === 'generate_mock') {
      const result = await examFlowService.startMock({
        subject: '行测',
        date: today(),
        questionCount: asNumber(args.questionCount, 120),
        durationMinutes: 120,
        tags: [],
        essayType: 'short'
      });
      await attachSessionToTask(result, meta.sessionId);
      return { taskId: result.task.id, reply: taskReply(result, '行测模考') };
    }

    if (call.name === 'generate_essay') {
      const essayTopic = asString(args.essayTopic) || '申论小题';
      const essayType = args.essayType === 'long' || essayTopic === '申发论述' ? 'long' : 'short';
      const context = essayFlowService.writeContext({
        date: today(),
        topic: essayTopic,
        type: essayType
      });
      const result = await essayFlowService.enqueueQuestionGeneration(context, {
        questionCount: asNumber(args.questionCount, 1)
      });
      await attachSessionToTask(result, meta.sessionId);
      return { taskId: result.task.id, reply: taskReply(result, `${context.topic}申论题`) };
    }

    if (call.name === 'generate_digest') {
      const tab = args.digestTab === 'tips' ? 'tips' : 'news';
      const result = await digestService.enqueueGenerate(tab, today());
      await attachSessionToTask(result, meta.sessionId);
      return { taskId: result.task.id, reply: taskReply(result, tab === 'tips' ? '每日知识点' : '每日热点') };
    }

    if (call.name === 'generate_monthly_digest') {
      const { year, month } = monthlyDigestService.currentMonth();
      const result = await monthlyDigestService.enqueueReport(year, month);
      await attachSessionToTask(result, meta.sessionId);
      return { taskId: result.task.id, reply: taskReply(result, '时政月报') };
    }

    if (call.name === 'grade_essay') {
      return { reply: '申论批改需要先在申论页面输入作答内容，再点“提交批改”。我不会在对话里直接伪造批改任务。' };
    }

    if (call.name === 'review_interview') {
      return { reply: '面试深度点评需要先完成一次面试模拟。完成后在结果页点“生成点评”，任务会进入队列。' };
    }

    return { reply: '这个工具暂时还没有接入。' };
  }
}

async function attachSessionToTask(result: EnqueueResult, sessionId?: string): Promise<void> {
  if (!sessionId) return;
  await taskStore.update(result.task.id, {
    payload: {
      ...(result.task.payload || {}),
      sessionId
    }
  });
}

export const aiBusinessTools = new AIBusinessTools();
