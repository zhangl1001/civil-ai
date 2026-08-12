export type InterviewType = 'structured' | 'group';
export type InterviewDifficulty = 'easy' | 'medium' | 'hard';
export type InterviewQuestionType = '综合分析' | '计划组织' | '人际沟通' | '应急应变' | '岗位匹配';

export const INTERVIEW_QUESTION_TYPES: readonly InterviewQuestionType[] = ['综合分析', '计划组织', '人际沟通', '应急应变', '岗位匹配'];

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

export function pickInterviewQuestions(input: {
  selectedTypes: readonly InterviewQuestionType[];
  count: number;
  excludedIds: ReadonlySet<string>;
  generatedQuestions: readonly InterviewQuestion[];
  fallbackQuestions: readonly InterviewQuestion[];
  random?: () => number;
}): InterviewQuestion[] {
  const selectedTypes = input.selectedTypes.length ? input.selectedTypes : ['综合分析'];
  const pool = [
    ...input.generatedQuestions.filter((question) => selectedTypes.includes(question.type)),
    ...input.fallbackQuestions.filter((question) => selectedTypes.includes(question.type))
  ];
  const unseen = pool.filter((question) => !input.excludedIds.has(question.id));
  const candidates = unseen.length >= input.count
    ? unseen
    : [...unseen, ...pool.filter((question) => input.excludedIds.has(question.id))];
  return shuffle(candidates, input.random ?? Math.random).slice(0, input.count);
}

export function prepareInterviewAnswers(answers: readonly InterviewAnswer[]): InterviewAnswer[] {
  return answers.map((answer) => {
    const text = answer.skipped ? '' : (answer.transcript || answer.answer).trim();
    return {
      ...answer,
      completeness: {
        status: !text ? 'empty' : text.length < 40 ? 'brief' : 'substantive',
        characterCount: text.length
      }
    };
  });
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}
