import { DEFAULT_CHOICE_GRADING_RULE, type ChoiceGradingRule } from '@/modules/evidence/public';
import type { ExamDeliveryKind, ExamSubjectView } from '@/modules/curriculum/public';

/**
 * Objective-question scoring rule of the active exam package.
 *
 * Held here rather than in the grader so the rule travels with the package:
 * exams disagree on whether an incomplete-but-correct selection scores at all.
 * Submission is synchronous and atomic, so reading the active package at grade
 * time cannot straddle a package change the way durable work can.
 */
const OBJECTIVE_DELIVERY_KIND: ExamDeliveryKind = 'objective';

let activeRule: ChoiceGradingRule = DEFAULT_CHOICE_GRADING_RULE;

export function installChoiceGradingRule(subjects: readonly ExamSubjectView[]): void {
  const declared = subjects
    .find((subject) => subject.deliveryKind === OBJECTIVE_DELIVERY_KIND && subject.choiceGrading)
    ?.choiceGrading;
  activeRule = declared ?? DEFAULT_CHOICE_GRADING_RULE;
}

export function choiceGradingRule(): ChoiceGradingRule {
  return activeRule;
}
