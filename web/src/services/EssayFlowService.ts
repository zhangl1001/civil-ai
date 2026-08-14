import { isLongFormTopic } from '@/domain/writtenFormats';
import { primarySubjectOfKind } from '@/domain/subjectDelivery';
import { ExamDeliveryKind } from '@/modules/curriculum/public';
import { generationTaskService } from './GenerationTaskService';
import type { AgentTaskEnqueueResult } from './GenerationTaskService';
import {
  createEssayQuestionSetId,
  essayQuestionSetGenerationScope,
  normalizeEssayQuestionSetMode,
  normalizeEssayQuestionSetPurpose,
  type EssayQuestionSetPurpose
} from '@/domain/essayQuestionSet';

export interface EssayGenerationContext {
  questionSetId?: string;
  date: string;
  topic: string;
  type: 'short' | 'long';
  entryMode?: EssayEntryMode;
  purpose?: EssayQuestionSetPurpose;
  capabilityNodeId?: string;
  dailyPlanId?: string;
  dailyPlanItemId?: string;
  reviewQueueItemId?: string;
  assessmentRole?: string;
}

export interface EssayContext extends EssayGenerationContext {
  questionSetId: string;
}

export type EssayEntryMode = 'tutor' | 'self' | 'true';

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function typeFromTopic(topic: string): EssayContext['type'] {
  return isLongFormTopic(topic) ? 'long' : 'short';
}

export class EssayFlowService {
  readGenerationDefaults(): EssayGenerationContext {
    const date = localStorage.getItem('es-date') || today();
    const topic = localStorage.getItem('essay-topic') || '申论';
    return {
      date,
      topic,
      type: typeFromTopic(topic)
    };
  }

  writeContext(context: EssayContext): EssayContext {
    const questionSetId = context.questionSetId.trim();
    if (!questionSetId) throw new TypeError('Essay context requires questionSetId');
    const next: EssayContext = {
      ...context,
      questionSetId,
      entryMode: normalizeEssayQuestionSetMode(context.entryMode),
      purpose: normalizeEssayQuestionSetPurpose(context.purpose, context.entryMode)
    };
    localStorage.setItem('es-date', context.date);
    if (context.topic && context.topic !== '申论') localStorage.setItem('essay-topic', context.topic);
    else localStorage.removeItem('essay-topic');
    return next;
  }

  async enqueueGrading(
    content: string,
    context: EssayContext,
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
        entryMode: normalizeEssayQuestionSetMode(context.entryMode),
        purpose: normalizeEssayQuestionSetPurpose(context.purpose, context.entryMode)
      }
    });
  }

  async enqueueQuestionGeneration(
    context: EssayGenerationContext,
    options: { questionCount?: number; title?: string; idempotencyKey?: string } = {}
  ): Promise<AgentTaskEnqueueResult> {
    const count = Math.max(1, Math.min(3, Number(options.questionCount || 1)));
    const questionSetId = context.questionSetId?.trim() || createEssayQuestionSetId();
    const entryMode = normalizeEssayQuestionSetMode(context.entryMode);
    const purpose = normalizeEssayQuestionSetPurpose(context.purpose, entryMode);
    return generationTaskService.enqueue({
      idempotencyKey: options.idempotencyKey,
      intent: 'mock',
      title: options.title || `生成${writtenSubjectName()}题目`,
      detail: `${context.topic} · ${count} 题 · ${context.date}`,
      module: writtenSubjectName(),
      sourceId: questionSetId,
      scopeId: essayQuestionSetGenerationScope({ ...context, questionSetId, entryMode, purpose }),
      payload: {
        deliveryKind: ExamDeliveryKind.Subjective,
        questionSetId,
        date: context.date,
        essayTopic: context.topic,
        essayType: context.type,
        entryMode,
        purpose,
        essayQuestionCount: count,
        ...(context.capabilityNodeId ? { capabilityNodeId: context.capabilityNodeId } : {}),
        ...(context.dailyPlanId ? { dailyPlanId: context.dailyPlanId } : {}),
        ...(context.dailyPlanItemId ? { dailyPlanItemId: context.dailyPlanItemId } : {}),
        ...(context.reviewQueueItemId ? { reviewQueueItemId: context.reviewQueueItemId } : {}),
        ...(context.assessmentRole ? { assessmentRole: context.assessmentRole } : {})
      }
    });
  }
}

export const essayFlowService = new EssayFlowService();

/** What the active package calls the subject answered in writing. */
function writtenSubjectName(): string {
  const subject = primarySubjectOfKind(ExamDeliveryKind.Subjective);
  return subject?.shortName ?? subject?.name ?? '主观题';
}
