import { ExamDeliveryKind, type ExamSubjectView } from '@/modules/curriculum/public';
import type { SubjectCode } from '@/kernel/public';

/**
 * How each subject of the active exam package is answered.
 *
 * Held here so pages can route a subject to the right flow without knowing any
 * subject code: which subjects exist is the package's business, but where a
 * candidate lands is decided by how the subject is answered.
 */
let deliveryBySubject: ReadonlyMap<string, ExamDeliveryKind> = new Map();
let subjectsByKind: ReadonlyMap<ExamDeliveryKind, readonly ExamSubjectView[]> = new Map();

export function installSubjectDelivery(subjects: readonly ExamSubjectView[]): void {
  const bySubject = new Map<string, ExamDeliveryKind>();
  const byKind = new Map<ExamDeliveryKind, ExamSubjectView[]>();
  for (const subject of subjects) {
    bySubject.set(subject.code, subject.deliveryKind);
    const bucket = byKind.get(subject.deliveryKind);
    if (bucket) bucket.push(subject);
    else byKind.set(subject.deliveryKind, [subject]);
  }
  deliveryBySubject = bySubject;
  subjectsByKind = byKind;
}

/** Undefined for a subject the active package does not offer. */
export function subjectDeliveryKind(subject: SubjectCode | string | undefined): ExamDeliveryKind | undefined {
  return subject === undefined ? undefined : deliveryBySubject.get(subject);
}

/**
 * The subject a flow should present when it was entered by answering mode
 * rather than by subject — the practice page reached from a plan item, say.
 *
 * Returns the package's first subject of that kind. A package offering several
 * objective subjects therefore names one of them, which is a limitation of the
 * flows that take a mode rather than of this lookup.
 */
export function primarySubjectOfKind(kind: ExamDeliveryKind): ExamSubjectView | undefined {
  return subjectsByKind.get(kind)?.[0];
}

export function isInterviewSubject(subject: SubjectCode | string | undefined): boolean {
  return subjectDeliveryKind(subject) === ExamDeliveryKind.Interview;
}
