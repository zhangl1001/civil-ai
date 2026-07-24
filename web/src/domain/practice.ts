export type PracticeMode = 'practice' | 'review' | 'mock' | 'essay' | 'diagnostic';

export interface PracticeSession {
  id: string;
  projectId: string;
  mode: PracticeMode;
  module?: string;
  date: string;
  questionCount: number;
  correctCount: number;
  accuracy: number;
  durationMs?: number;
  sourceFile?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AnswerRecord {
  id: string;
  sessionId: string;
  questionId: string;
  userAnswer: string | string[];
  correct: boolean;
  status?: 'correct' | 'wrong' | 'blank';
  correctAnswer?: string | string[];
  explanationSnapshot?: string;
  errorType?: string;
  errorDetail?: string;
  correctApproach?: string;
  tips?: string;
  aiAnalysisTaskId?: string;
  elapsedMs?: number;
  createdAt: number;
}
