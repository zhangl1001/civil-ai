import type { ContentDocument } from './ContentDocument';
import type { QuestionPresentationCode, QuestionTemplateCode } from '../domain/ContentCodes';

export interface SingleChoiceOption {
  readonly id: string;
  readonly content: ContentDocument;
}

/** Regions every choice template shares. The answer key is what differs. */
export interface ChoiceQuestionShape {
  readonly presentationCode: QuestionPresentationCode;
  readonly schemaVersion: string;
  readonly capabilityCode: string;
  readonly materialGroupId?: string;
  readonly material?: ContentDocument;
  readonly prompt: ContentDocument;
  readonly options: readonly SingleChoiceOption[];
  readonly explanation: ContentDocument;
}

export interface SingleChoiceQuestionContent extends ChoiceQuestionShape {
  readonly templateCode: typeof QuestionTemplateCode.SingleChoice;
  readonly correctOptionId: string;
}

/**
 * Templates whose answer key is a set of options. `multiple_choice` tells the
 * candidate up front that more than one option is correct; for
 * `indeterminate_choice` the count is undisclosed, so a single correct option
 * is also valid. Both store the same shape — only the instruction and the
 * partial-credit rule differ, and that rule lives in the grading policy.
 */
export interface MultiAnswerChoiceQuestionContent extends ChoiceQuestionShape {
  readonly templateCode:
    | typeof QuestionTemplateCode.MultipleChoice
    | typeof QuestionTemplateCode.IndeterminateChoice;
  readonly correctOptionIds: readonly string[];
}

export type QuestionContent = SingleChoiceQuestionContent | MultiAnswerChoiceQuestionContent;
