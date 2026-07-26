import { generationTaskService } from './GenerationTaskService';
import type { AgentTaskEnqueueResult } from './GenerationTaskService';

export interface EssayContext {
  date: string;
  topic: string;
  type: 'short' | 'long';
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function typeFromTopic(topic: string): EssayContext['type'] {
  if (topic === '申发论述') return 'long';
  return 'short';
}

export class EssayFlowService {
  readContext(): EssayContext {
    const date = localStorage.getItem('es-date') || today();
    const topic = localStorage.getItem('essay-topic') || '申论';
    return {
      date,
      topic,
      type: typeFromTopic(topic)
    };
  }

  writeContext(patch: Partial<EssayContext>): EssayContext {
    const next = { ...this.readContext(), ...patch };
    localStorage.setItem('es-date', next.date);
    if (next.topic && next.topic !== '申论') localStorage.setItem('essay-topic', next.topic);
    else localStorage.removeItem('essay-topic');
    return next;
  }

  async enqueueGrading(content: string, context = this.readContext()): Promise<AgentTaskEnqueueResult> {
    return generationTaskService.enqueue({
      intent: 'essayGrade',
      title: '申论批改',
      detail: `${context.topic} · ${context.date}`,
      sourceId: `${context.topic}:${context.date}`,
      payload: {
        content,
        essayDate: context.date,
        essayTopic: context.topic,
        essayType: context.type
      }
    });
  }

  async enqueueQuestionGeneration(
    context = this.readContext(),
    options: { questionCount?: number; title?: string } = {}
  ): Promise<AgentTaskEnqueueResult> {
    const count = Math.max(1, Math.min(3, Number(options.questionCount || 1)));
    return generationTaskService.enqueue({
      intent: 'mock',
      title: options.title || '生成申论题目',
      detail: `${context.topic} · ${count} 题 · ${context.date}`,
      module: '申论',
      sourceId: `essay:${context.topic}:${context.date}:${context.type}:${count}`,
      payload: {
        subject: '申论',
        date: context.date,
        essayTopic: context.topic,
        essayType: context.type,
        essayQuestionCount: count
      }
    });
  }
}

export const essayFlowService = new EssayFlowService();
