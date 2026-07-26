import type { ContentDocument } from './ContentDocument';

export interface SingleChoiceOption {
  readonly id: string;
  readonly content: ContentDocument;
}

export interface SingleChoiceQuestionContent {
  readonly templateCode: 'single_choice';
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
