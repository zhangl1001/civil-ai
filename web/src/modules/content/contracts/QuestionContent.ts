import type { ContentDocument } from './ContentDocument';
import type { QuestionPresentationCode } from '../domain/ContentCodes';

export interface SingleChoiceOption {
  readonly id: string;
  readonly content: ContentDocument;
}

export interface SingleChoiceQuestionContent {
  readonly templateCode: 'single_choice';
  readonly presentationCode: QuestionPresentationCode;
  readonly schemaVersion: string;
  readonly capabilityCode: string;
  readonly materialGroupId?: string;
  readonly material?: ContentDocument;
  readonly prompt: ContentDocument;
  readonly options: readonly SingleChoiceOption[];
  readonly correctOptionId: string;
  readonly explanation: ContentDocument;
}

export type QuestionContent = SingleChoiceQuestionContent;
