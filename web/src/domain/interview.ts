export type InterviewType = 'structured' | 'group';
export type InterviewDifficulty = 'easy' | 'medium' | 'hard';
export type InterviewQuestionType = '综合分析' | '计划组织' | '人际沟通' | '应急应变' | '岗位匹配';

export interface InterviewQuestion {
  id: string;
  type: InterviewQuestionType;
  text: string;
  hint: string;
}

export interface InterviewAnswer {
  question: InterviewQuestion;
  answer: string;
  transcript?: string;
  skipped: boolean;
  elapsedSeconds: number;
  speechMetrics?: InterviewSpeechMetrics;
  completeness?: InterviewAnswerCompleteness;
}

export interface InterviewAnswerCompleteness {
  status: 'empty' | 'brief' | 'substantive';
  characterCount: number;
}

export interface InterviewSpeechMetrics {
  durationSeconds: number;
  wordCount: number;
  wordsPerMinute: number;
  fillerCount: number;
}

export interface InterviewScore {
  total: number;
  confidence: number;
  rubricVersion: string;
  dimensions: InterviewScoreDimension[];
}

export interface InterviewScoreDimension {
  code: 'content' | 'structure' | 'expression' | 'fluency';
  name: string;
  score: number;
  comment: string;
  evidence?: string;
}

export interface InterviewSession {
  id: string;
  projectId: string;
  date: string;
  interviewType: InterviewType;
  difficulty: InterviewDifficulty;
  questionTypes: InterviewQuestionType[];
  questionCount: number;
  answers: InterviewAnswer[];
  reviewStatus: 'pending' | 'completed' | 'failed';
  score?: InterviewScore;
  aiFeedback?: string;
  aiSuggestions?: string[];
  reviewTaskId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface InterviewStats {
  totalSessions: number;
  averageScore: number;
  latest?: InterviewSession;
}
