import { generationTaskService } from './GenerationTaskService';
import type { AgentTaskEnqueueResult } from './GenerationTaskService';
import {
  createEssayQuestionSetId,
  essayQuestionSetGenerationScope,
  normalizeEssayQuestionSetMode
} from '@/domain/essayQuestionSet';

export interface EssayContext {
  questionSetId?: string;
  date: string;
  topic: string;
  type: 'short' | 'long';
  entryMode?: EssayEntryMode;
}

export type EssayEntryMode = 'tutor' | 'self' | 'true';

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

  async enqueueGrading(
    content: string,
    context = this.readContext(),
    idempotencyKey?: string
  ): Promise<AgentTaskEnqueueResult> {
    return generationTaskService.enqueue({
      idempotencyKey,
      intent: 'essayGrade',
      title: '申论批改',
      detail: `${context.topic} · ${context.date}`,
      sourceId: context.questionSetId || `${context.topic}:${context.date}`,
      payload: {
        content,
        questionSetId: context.questionSetId,
        essayDate: context.date,
        essayTopic: context.topic,
        essayType: context.type,
        entryMode: normalizeEssayQuestionSetMode(context.entryMode)
      }
    });
  }

  async enqueueQuestionGeneration(
    context = this.readContext(),
    options: { questionCount?: number; title?: string; idempotencyKey?: string } = {}
  ): Promise<AgentTaskEnqueueResult> {
    const count = Math.max(1, Math.min(3, Number(options.questionCount || 1)));
    const questionSetId = context.questionSetId?.trim() || createEssayQuestionSetId();
    const entryMode = normalizeEssayQuestionSetMode(context.entryMode);
    return generationTaskService.enqueue({
      idempotencyKey: options.idempotencyKey,
      intent: 'mock',
      title: options.title || '生成申论题目',
      detail: `${context.topic} · ${count} 题 · ${context.date}`,
      module: '申论',
      sourceId: questionSetId,
      scopeId: essayQuestionSetGenerationScope({ ...context, questionSetId, entryMode }),
      payload: {
        subject: '申论',
        questionSetId,
        date: context.date,
        essayTopic: context.topic,
        essayType: context.type,
        entryMode,
        essayQuestionCount: count
      }
    });
  }
}

export const essayFlowService = new EssayFlowService();
