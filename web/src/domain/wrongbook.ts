export type WrongStatus = 'open' | 'reviewing' | 'mastered';

export interface WrongItem {
  id: string;
  projectId: string;
  questionId: string;
  module?: string;
  reason?: string;
  wrongCount: number;
  status: WrongStatus;
  lastWrongAt: number;
  nextReviewAt?: number;
  createdAt: number;
  updatedAt: number;
}
