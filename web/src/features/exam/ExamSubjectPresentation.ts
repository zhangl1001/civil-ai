import { ExamDeliveryKind, type ExamSubjectView } from '@/modules/curriculum/public';
import type { EssayMockType, ExamStartContext } from '@/domain/examMock';

/**
 * Copy for the mock exam flow. Wording is chosen by how a subject is answered,
 * never by its name, so a curriculum package with different subjects reads
 * correctly without touching the page.
 */

export function essayTypeLabel(type: EssayMockType): string {
  return type === 'long' ? '大作文' : '小题';
}

/** Subject name for headings and buttons, matching how the rest of the app names it. */
export function subjectDisplayName(subject: ExamSubjectView): string {
  return subject.shortName?.trim() || subject.name;
}

export function mockHeadline(subject: ExamSubjectView): string {
  return subject.deliveryKind === ExamDeliveryKind.Objective
    ? '生成套卷，按考试节奏完成训练'
    : '生成材料，进入限时作答';
}

export function mockStartLabel(subject: ExamSubjectView): string {
  return `生成并进入${subjectDisplayName(subject)}模考`;
}

export function mockConfigTitle(subject: ExamSubjectView, context: ExamStartContext): string {
  return subject.deliveryKind === ExamDeliveryKind.Objective
    ? `${context.questionCount} 题 · ${context.durationMinutes} 分钟`
    : essayTypeLabel(context.essayType);
}

export function mockConfigSummary(subject: ExamSubjectView, context: ExamStartContext): string {
  if (subject.deliveryKind !== ExamDeliveryKind.Objective) {
    return `${context.date} · ${essayTypeLabel(context.essayType)}`;
  }
  const tags = context.tags.length ? ` · ${context.tags.slice(0, 2).join('、')}` : '';
  return `${context.date} · ${context.questionCount}题 · ${context.durationMinutes}分钟${tags}`;
}

export function emptyHistoryTitle(subject: ExamSubjectView): string {
  return `还没有${subjectDisplayName(subject)}模考记录`;
}
