import type { RouteLocationRaw } from 'vue-router';
import {
  normalizeEssayQuestionSetMode,
  normalizeEssayQuestionSetPurpose,
  type EssayQuestionSetMode,
  type EssayQuestionSetPurpose
} from '@/domain/essayQuestionSet';

export interface EssayQuestionSetRouteTarget {
  readonly questionSetId: string;
  readonly entryMode?: EssayQuestionSetMode;
  readonly date: string;
  readonly topic: string;
  readonly type: 'short' | 'long';
  readonly purpose?: EssayQuestionSetPurpose;
}

export interface EssayHistoryRouteTarget {
  readonly questionSetId?: string;
  readonly essayEntryMode?: EssayQuestionSetMode;
  readonly date: string;
  readonly essayTopic?: string;
  readonly title: string;
  readonly essayType?: 'short' | 'long';
  readonly essayPurpose?: EssayQuestionSetPurpose;
}

export function essayCenterLocation(entryMode: EssayQuestionSetMode = 'tutor'): RouteLocationRaw {
  return {
    path: '/vue/practice',
    query: { subject: 'essay', mode: normalizeEssayQuestionSetMode(entryMode) }
  };
}

export function essayQuestionSetLocation(target: EssayQuestionSetRouteTarget): RouteLocationRaw {
  const questionSetId = target.questionSetId.trim();
  if (!questionSetId) throw new TypeError('Essay question-set navigation requires questionSetId');
  return {
    path: '/vue/essay',
    query: {
      questionSetId,
      entryMode: normalizeEssayQuestionSetMode(target.entryMode),
      date: target.date,
      topic: target.topic,
      type: target.type,
      purpose: normalizeEssayQuestionSetPurpose(target.purpose, target.entryMode)
    }
  };
}

export function essayHistoryLocation(target: EssayHistoryRouteTarget): RouteLocationRaw {
  if (!target.questionSetId?.trim()) return essayCenterLocation('self');
  return essayQuestionSetLocation({
    questionSetId: target.questionSetId,
    entryMode: target.essayEntryMode,
    date: target.date,
    topic: target.essayTopic || target.title,
    type: target.essayType || 'short',
    purpose: target.essayPurpose
  });
}

export function essayQuestionSetTargetFromQuery(query: Readonly<Record<string, unknown>>): EssayQuestionSetRouteTarget | undefined {
  const questionSetId = text(query.questionSetId);
  if (!questionSetId) return undefined;
  const topic = text(query.topic) || '申论';
  return {
    questionSetId,
    entryMode: normalizeEssayQuestionSetMode(text(query.entryMode) || text(query.mode)),
    date: text(query.date) || localDate(),
    topic,
    type: text(query.type) === 'long' ? 'long' : 'short',
    purpose: normalizeEssayQuestionSetPurpose(text(query.purpose), text(query.entryMode) || text(query.mode))
  };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
