import { DEFAULT_CHOICE_GRADING_RULE, type ChoiceGradingRule } from '@/modules/evidence/public';
import { QuestionTemplateCode, type QuestionSetGradingPolicy } from '@/modules/content/public';
import { ExamDeliveryKind, type ExamChoiceGradingRule, type ExamSubjectView } from '@/modules/curriculum/public';
import { subjectOfCapabilityNode } from './subjectDelivery';

/**
 * Objective-question scoring rules of the active exam package, per subject.
 *
 * Held here rather than in the grader so the rule travels with the package:
 * exams disagree on whether an incomplete-but-correct selection scores at all,
 * and a package may disagree with itself — one subject can award partial credit
 * for 少选 while another awards none. Question sets freeze their subject's rule
 * when published, so the active rule is only consulted for sets that carry no
 * snapshot of their own.
 */
let policyBySubject: ReadonlyMap<string, ExamChoiceGradingRule> = new Map();

export function installChoiceGradingRule(subjects: readonly ExamSubjectView[]): void {
  policyBySubject = new Map(
    subjects
      .filter((subject) => subject.deliveryKind === ExamDeliveryKind.Objective && subject.choiceGrading)
      .map((subject) => [subject.code as string, subject.choiceGrading!])
  );
}

function policyFor(subject: string | undefined): ExamChoiceGradingRule | undefined {
  if (subject !== undefined) return policyBySubject.get(subject);
  // No subject in hand: only a package that scores every objective subject the
  // same way has an unambiguous answer. Guessing one of several would mark a
  // paper by another subject's rule.
  const [only] = [...policyBySubject.values()];
  return policyBySubject.size === 1 ? only : undefined;
}

/** Narrowed to what the grader takes: the policy identity is not a grading input. */
export function choiceGradingRule(subject?: string): ChoiceGradingRule {
  return {
    underSelectionCreditWeight: (policyFor(subject) ?? DEFAULT_CHOICE_GRADING_RULE).underSelectionCreditWeight
  };
}

/** Resolves the active package rule when a legacy question set has no frozen policy. */
export function choiceGradingRuleForCapabilityNode(capabilityNodeId: string | undefined): ChoiceGradingRule {
  return choiceGradingRule(subjectOfCapabilityNode(capabilityNodeId));
}

/**
 * The snapshot a question set published now should freeze, for the subject the
 * given capability node belongs to.
 *
 * Undefined when that subject declares no rule, or declares one without the
 * identity that makes a frozen score explainable — in either case the set
 * records nothing and grades against whatever rule is active when answered.
 */
export function gradingPolicyForCapabilityNode(
  capabilityNodeId: string | undefined
): QuestionSetGradingPolicy | undefined {
  const policy = policyFor(subjectOfCapabilityNode(capabilityNodeId));
  if (!policy?.policyVersion || !policy.policyHash) return undefined;
  return {
    underSelectionCreditWeight: policy.underSelectionCreditWeight,
    policyVersion: policy.policyVersion,
    policyHash: policy.policyHash
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
