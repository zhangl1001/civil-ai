import type { JsonObject } from '@/kernel/public';
import type {
  MultiAnswerChoiceQuestionContent,
  QuestionContent,
  SingleChoiceQuestionContent
} from '../contracts/QuestionContent';
import { QuestionTemplateCode } from './ContentCodes';

/**
 * Single place that knows how each choice template stores its answer key, so
 * readers never branch on `templateCode` themselves and adding a template does
 * not scatter new conditionals across callers.
 */

export function isSingleChoice(content: QuestionContent): content is SingleChoiceQuestionContent {
  return content.templateCode === QuestionTemplateCode.SingleChoice;
}

export function isMultiAnswerChoice(content: QuestionContent): content is MultiAnswerChoiceQuestionContent {
  return content.templateCode === QuestionTemplateCode.MultipleChoice
    || content.templateCode === QuestionTemplateCode.IndeterminateChoice;
}

/**
 * Correct option ids, in the order the options are presented.
 *
 * Throws rather than returning an empty key: content without a usable answer
 * would otherwise grade every attempt as wrong, and a silent zero is far harder
 * to trace than a failed submission.
 */
export function correctOptionIdsOf(content: QuestionContent): readonly string[] {
  if (isMultiAnswerChoice(content)) {
    const order = content.options.map((option) => option.id);
    return [...content.correctOptionIds].sort((left, right) => order.indexOf(left) - order.indexOf(right));
  }
  if (isSingleChoice(content) && content.correctOptionId) return [content.correctOptionId];
  throw new TypeError(`Choice question has no answer key (templateCode: ${String(content.templateCode)})`);
}

/** Answer key as shown to the candidate, e.g. `A` or `ABD`. */
export function correctAnswerLabel(content: QuestionContent): string {
  return correctOptionIdsOf(content).join('');
}

/**
 * Denormalized answer key stored on the question row. Grading reads the content
 * itself, so this stays a convenience copy rather than a second source of truth.
 */
export function correctAnswerRecord(content: QuestionContent): JsonObject {
  return { optionIds: [...correctOptionIdsOf(content)] };
}

/** How many options a candidate may select. Drives selection UI and validation. */
export function maxSelectableOptions(content: QuestionContent): number {
  return isMultiAnswerChoice(content) ? content.options.length : 1;
}
