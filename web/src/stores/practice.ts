import { defineStore } from 'pinia';
import type { PracticeMode, PracticeSession } from '@/domain/practice';
import { practiceSessionRepository } from '@/services/PracticeSessionRepository';
import { questionRepository, type PracticeLecture, type PracticeQuestion } from '@/services/QuestionRepository';
import { practiceFlowService, type PracticeStartContext } from '@/services/PracticeFlowService';

export type Question = PracticeQuestion;

export interface PracticeState {
  questions: Question[];
  lecture: PracticeLecture | null;
  currentQuestionIndex: number;
  userAnswers: (number | null)[];
  recentSessions: PracticeSession[];
  startedAt: number;
  completedSessionId: string | null;
  module: string;
  knowledgePoint?: string;
  mode: PracticeMode;
  context: PracticeStartContext | null;
  error: string | null;
  isFinished: boolean;
  isLoading: boolean;
  isSaving: boolean;
}

export interface PracticeDraftSnapshot {
  context: PracticeStartContext;
  questions: Question[];
  currentQuestionIndex: number;
  userAnswers: (number | null)[];
  submittedIndexes: number[];
  startedAt: number;
  savedAt: number;
}

export const usePracticeStore = defineStore('practice', {
  state: (): PracticeState => ({
    questions: [],
    lecture: null,
    currentQuestionIndex: 0,
    userAnswers: [],
    recentSessions: [],
    startedAt: 0,
    completedSessionId: null,
    module: '专项练习',
    knowledgePoint: undefined,
    mode: 'practice',
    context: null,
    error: null,
    isFinished: false,
    isLoading: true,
    isSaving: false,
  }),

  getters: {
    currentQuestion(state): Question | null {
      return state.questions[state.currentQuestionIndex] || null;
    },
    progress(state): number {
      return state.questions.length > 0 ? (state.currentQuestionIndex / state.questions.length) * 100 : 0;
    },
    score(state): number {
      return state.userAnswers.reduce<number>((correctCount, answer, index) => {
        if (answer !== null && answer === state.questions[index].answer) {
          return correctCount + 1;
        }
        return correctCount;
      }, 0);
    }
  },

  actions: {
    async fetchRecentSessions() {
      this.recentSessions = await practiceSessionRepository.latest(7);
    },

    showCenter() {
      this.questions = [];
      this.lecture = null;
      this.currentQuestionIndex = 0;
      this.userAnswers = [];
      this.startedAt = 0;
      this.completedSessionId = null;
      this.error = null;
      this.context = practiceFlowService.readStartContext();
      this.isFinished = false;
      this.isLoading = false;
      this.isSaving = false;
    },

    async start(context: PracticeStartContext = practiceFlowService.readStartContext()) {
      this.isLoading = true;
      this.error = null;
      try {
        this.context = context;
        this.module = context.module;
        this.knowledgePoint = context.knowledgePoint;
        this.mode = context.mode;
        this.questions = context.questionIds?.length
          ? await questionRepository.listByIds(context.questionIds)
          : await questionRepository.listForPractice({
            module: context.module,
            knowledgePoint: context.knowledgePoint,
            limit: context.questionCount,
            sourceRef: context.sourceRef
          });
        this.lecture = await questionRepository.lectureForQuestions(this.questions) || null;
        this.userAnswers = new Array(this.questions.length).fill(null);
        this.currentQuestionIndex = 0;
        this.isFinished = false;
        this.completedSessionId = null;
        this.startedAt = Date.now();
        await this.fetchRecentSessions();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        this.questions = [];
        this.lecture = null;
      } finally {
        this.isLoading = false;
      }
    },

    restoreDraft(snapshot: PracticeDraftSnapshot) {
      this.context = snapshot.context;
      this.module = snapshot.context.module;
      this.knowledgePoint = snapshot.context.knowledgePoint;
      this.mode = snapshot.context.mode;
      this.questions = snapshot.questions;
      this.lecture = null;
      void questionRepository.lectureForQuestions(snapshot.questions).then((lecture) => {
        this.lecture = lecture || null;
      });
      this.userAnswers = snapshot.userAnswers;
      this.currentQuestionIndex = Math.min(snapshot.currentQuestionIndex, Math.max(0, snapshot.questions.length - 1));
      this.startedAt = snapshot.startedAt || Date.now();
      this.completedSessionId = null;
      this.error = null;
      this.isFinished = false;
      this.isLoading = false;
      this.isSaving = false;
    },

    async fetchQuestions(_practiceId?: string, module?: string) {
      const context = practiceFlowService.writeStartContext({
        module: module || practiceFlowService.readStartContext().module
      });
      await this.start(context);
    },

    selectAnswer(optionIndex: number) {
      if (this.isFinished || !this.currentQuestion) return;
      this.userAnswers[this.currentQuestionIndex] = optionIndex;
    },

    async nextQuestion() {
      if (this.currentQuestionIndex < this.questions.length - 1) {
        this.currentQuestionIndex++;
      } else {
        this.isFinished = true;
        await this.saveCurrentSession();
      }
    },

    async saveCurrentSession(): Promise<PracticeSession | undefined> {
      if (this.completedSessionId || this.isSaving || !this.questions.length) return undefined;
      this.isSaving = true;
      try {
        const session = await practiceSessionRepository.saveCompleted({
          mode: this.mode,
          module: this.module,
          questions: this.questions,
          userAnswers: this.userAnswers,
          durationMs: this.startedAt ? Date.now() - this.startedAt : undefined,
          sourceFile: this.context?.sourceRef || this.questions.find((question) => question.sourceFile)?.sourceFile
        });
        this.completedSessionId = session.id;
        await this.fetchRecentSessions();
        return session;
      } finally {
        this.isSaving = false;
      }
    },

    reset() {
      this.questions = [];
      this.lecture = null;
      this.currentQuestionIndex = 0;
      this.userAnswers = [];
      this.startedAt = 0;
      this.completedSessionId = null;
      this.error = null;
      this.context = null;
      this.isFinished = false;
      this.isLoading = true;
    }
  },
});
