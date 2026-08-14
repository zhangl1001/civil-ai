import { ExamDeliveryKind, type CapabilityNode, type ExamSubjectView } from '@/modules/curriculum/public';
import type { SubjectCode } from '@/kernel/public';

/**
 * Facts about the active exam package that application code needs in order to
 * stay out of the business of naming subjects.
 *
 * Which subjects exist, how each is answered, and which capability node belongs
 * to which subject are all the package's business; where a candidate lands and
 * how an answer is marked follow from them.
 */
let deliveryBySubject: ReadonlyMap<string, ExamDeliveryKind> = new Map();
let subjectsByKind: ReadonlyMap<ExamDeliveryKind, readonly ExamSubjectView[]> = new Map();
let subjectByCapabilityNode: ReadonlyMap<string, string> = new Map();
let objectiveSubjects: ReadonlySet<string> = new Set();

export function installSubjectDelivery(
  subjects: readonly ExamSubjectView[],
  nodes: readonly CapabilityNode[] = []
): void {
  const bySubject = new Map<string, ExamDeliveryKind>();
  const byKind = new Map<ExamDeliveryKind, ExamSubjectView[]>();
  const objective = new Set<string>();
  for (const subject of subjects) {
    bySubject.set(subject.code, subject.deliveryKind);
    if (subject.deliveryKind === ExamDeliveryKind.Objective) objective.add(subject.code);
    const bucket = byKind.get(subject.deliveryKind);
    if (bucket) bucket.push(subject);
    else byKind.set(subject.deliveryKind, [subject]);
  }
  deliveryBySubject = bySubject;
  subjectsByKind = byKind;
  objectiveSubjects = objective;
  subjectByCapabilityNode = new Map(nodes.map((node) => [node.id as string, node.subject as string]));
}

/** Undefined for a subject the active package does not offer. */
export function subjectDeliveryKind(subject: SubjectCode | string | undefined): ExamDeliveryKind | undefined {
  return subject === undefined ? undefined : deliveryBySubject.get(subject);
}

/**
 * Subjects this package answers with questions. Practice and objective
 * generation work on these; a package with two of them has two, which is why
 * callers must not assume the first one speaks for the rest.
 */
export function objectiveSubjectCodes(): ReadonlySet<string> {
  return objectiveSubjects;
}

/** Which subject a capability node belongs to, for work that only knows a node. */
export function subjectOfCapabilityNode(capabilityNodeId: string | undefined): string | undefined {
  return capabilityNodeId === undefined ? undefined : subjectByCapabilityNode.get(capabilityNodeId);
}

export function isObjectiveCapabilityNode(node: { readonly subject: string }): boolean {
  return objectiveSubjects.has(node.subject);
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
