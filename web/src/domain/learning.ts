export type LearningEventType = 'practice' | 'review' | 'essay' | 'mock' | 'digest' | 'grade';

export interface LearningEvent {
  id: string;
  projectId: string;
  type: LearningEventType;
  module?: string;
  date: string;
  total?: number;
  correct?: number;
  accuracy?: number;
  sourceRef?: string;
  createdAt: number;
}

export interface AbilityProfile {
  id: string;
  projectId: string;
  module: string;
  total: number;
  correct: number;
  accuracy: number;
  updatedAt: number;
}
