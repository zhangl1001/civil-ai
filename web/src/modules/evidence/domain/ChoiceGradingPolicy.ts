import { QuestionTemplateCode } from '@/modules/content/public';
import { AttemptResult } from './EvidenceCodes';

export interface ChoiceAnswerGrade {
  readonly result: AttemptResult;
  readonly score: number;
}

/** Algorithm version. Bump when the marking logic itself changes. */
export const CHOICE_GRADER_VERSION = 'objective-choice:v1';

/**
 * Grader identity recorded on a stored score: the algorithm version plus the
 * rule that parameterised it.
 *
 * The algorithm version alone is not enough to explain a score — two attempts
 * marked under different 少选 weights would be indistinguishable after the fact,
 * which is exactly what happens once an exam package is upgraded.
 */
export function choiceGraderVersion(policyHash?: string): string {
  return policyHash ? `${CHOICE_GRADER_VERSION}/${policyHash.slice(-12)}` : CHOICE_GRADER_VERSION;
}

/**
 * How an incomplete but correct selection scores. Exams differ on 少选, so the
 * exam package declares this rather than the grader hard-coding it; the default
 * applies only when no package rule reached the caller.
 */
export interface ChoiceGradingRule {
  /** Fraction of the proportional score kept for an under-selected answer. */
  readonly underSelectionCreditWeight: number;
}

export const DEFAULT_CHOICE_GRADING_RULE: ChoiceGradingRule = { underSelectionCreditWeight: 0.5 };

const SCORE_DECIMALS = 4;

/** Templates where selecting a correct-but-incomplete set earns partial credit. */
const PARTIAL_CREDIT_TEMPLATES: readonly QuestionTemplateCode[] = [
  QuestionTemplateCode.MultipleChoice,
  QuestionTemplateCode.IndeterminateChoice
];

/**
 * Deterministic grading for every choice template.
 *
 * Selecting any incorrect option scores nothing, matching how Chinese exams
 * treat 错选. Selecting a correct subset (少选) earns partial credit on
 * multi-answer templates only.
 */
export function gradeChoiceAnswer(
  templateCode: QuestionTemplateCode,
  correctOptionIds: readonly string[],
  selectedOptionIds: readonly string[],
  rule: ChoiceGradingRule = DEFAULT_CHOICE_GRADING_RULE
): ChoiceAnswerGrade {
  const selected = new Set(selectedOptionIds);
  if (selected.size === 0) return { result: AttemptResult.Unanswered, score: 0 };

  const correct = new Set(correctOptionIds);
  if ([...selected].some((optionId) => !correct.has(optionId))) {
    return { result: AttemptResult.Incorrect, score: 0 };
  }
  if (selected.size === correct.size) return { result: AttemptResult.Correct, score: 1 };
  if (!PARTIAL_CREDIT_TEMPLATES.includes(templateCode)) {
    return { result: AttemptResult.Incorrect, score: 0 };
  }
  const ratio = selected.size / correct.size * rule.underSelectionCreditWeight;
  return { result: AttemptResult.Partial, score: Number(ratio.toFixed(SCORE_DECIMALS)) };
}
