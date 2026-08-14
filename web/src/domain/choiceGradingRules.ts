import { DEFAULT_CHOICE_GRADING_RULE, type ChoiceGradingRule } from '@/modules/evidence/public';
import { QuestionTemplateCode, type QuestionSetGradingPolicy } from '@/modules/content/public';
import type { ExamChoiceGradingRule, ExamDeliveryKind, ExamSubjectView } from '@/modules/curriculum/public';

/**
 * Objective-question scoring rule of the active exam package.
 *
 * Held here rather than in the grader so the rule travels with the package:
 * exams disagree on whether an incomplete-but-correct selection scores at all.
 * Question sets freeze this rule when they are published, so the active rule is
 * only consulted for sets that carry no snapshot of their own.
 */
const OBJECTIVE_DELIVERY_KIND: ExamDeliveryKind = 'objective';

let activePolicy: ExamChoiceGradingRule | undefined;

export function installChoiceGradingRule(subjects: readonly ExamSubjectView[]): void {
  activePolicy = subjects
    .find((subject) => subject.deliveryKind === OBJECTIVE_DELIVERY_KIND && subject.choiceGrading)
    ?.choiceGrading;
}

/** Narrowed to what the grader takes: the policy identity is not a grading input. */
export function choiceGradingRule(): ChoiceGradingRule {
  return {
    underSelectionCreditWeight: (activePolicy ?? DEFAULT_CHOICE_GRADING_RULE).underSelectionCreditWeight
  };
}

/**
 * The snapshot a question set published now should freeze. Undefined when the
 * active package declares no rule, or declares one without the identity that
 * makes a frozen score explainable — in either case the set records nothing and
 * grades against whatever rule is active when it is answered.
 */
export function activeGradingPolicy(): QuestionSetGradingPolicy | undefined {
  if (!activePolicy?.policyVersion || !activePolicy.policyHash) return undefined;
  return {
    underSelectionCreditWeight: activePolicy.underSelectionCreditWeight,
    policyVersion: activePolicy.policyVersion,
    policyHash: activePolicy.policyHash
  };
}

/**
 * How a multi-answer question scores, in the candidate's words.
 *
 * Takes the rule rather than reading the active one, because a question set
 * freezes the rule it will actually be marked by: after a package upgrade the
 * page must promise what the grader will do with that set, not what the current
 * package would do. Falls back to the active rule where no set is in context.
 */
export function multiAnswerGradingHint(
  templateCode: QuestionTemplateCode,
  rule: ChoiceGradingRule = choiceGradingRule()
): string {
  const shape = templateCode === QuestionTemplateCode.MultipleChoice
    ? '多选题 · 至少两个正确选项'
    : '不定项选择 · 正确选项数量未知';
  const underSelection = rule.underSelectionCreditWeight > 0 ? '少选得部分分' : '少选不得分';
  return `${shape}，${underSelection}，错选不得分`;
}
