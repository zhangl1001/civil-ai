import { ExamDeliveryKind } from '@/modules/curriculum/public';
import { primarySubjectOfKind } from '@/domain/subjectDelivery';

/**
 * Which practice flow a route is asking for.
 *
 * These are answering modes wearing civil-service names: the values are the
 * wire format the practice route has always used, but what they select is the
 * objective flow versus the written one. Labels come from the installed package
 * so a track that calls its subjects something else says so on screen.
 */
export const PracticeSubject = {
  Aptitude: 'aptitude',
  Essay: 'essay'
} as const;

export type PracticeSubject = typeof PracticeSubject[keyof typeof PracticeSubject];

function deliveryKindOf(subject: PracticeSubject): ExamDeliveryKind {
  return subject === PracticeSubject.Essay ? ExamDeliveryKind.Subjective : ExamDeliveryKind.Objective;
}

/**
 * Names the package's own subject for this mode. Falls back to how the mode is
 * answered rather than to a civil-service subject name, so a package that has
 * not installed yet reads as generic instead of as the wrong exam.
 */
export function practiceSubjectLabel(subject: PracticeSubject): string {
  const named = primarySubjectOfKind(deliveryKindOf(subject));
  if (named) return named.shortName ?? named.name;
  return subject === PracticeSubject.Essay ? '主观题' : '客观题';
}

export function practiceSubjectShortLabel(subject: PracticeSubject): string {
  return [...practiceSubjectLabel(subject)][0] ?? '';
}
