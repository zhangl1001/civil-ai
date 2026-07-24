import { defineStore } from 'pinia';
import { essayRepository, type EssayHistoryRecord, type EssayLecture } from '@/services/EssayRepository';
import { essayFlowService, type EssayContext } from '@/services/EssayFlowService';

export interface EssayQuestion {
  id: string;
  title: string;
  material: string;
  requirement: string;
  lecture?: EssayLecture;
}

export interface EssaySubmission {
  content: string;
  feedback: string | null;
  isSubmitting: boolean;
}

export interface EssayState {
  question: EssayQuestion | null;
  submission: EssaySubmission;
  history: EssayHistoryRecord[];
  context: EssayContext | null;
  submitMessage: string;
  isLoading: boolean;
  error: string | null;
}

export const useEssayStore = defineStore('essay', {
  state: (): EssayState => ({
    question: null,
    submission: {
      content: '',
      feedback: null,
      isSubmitting: false,
    },
    history: [],
    context: null,
    submitMessage: '',
    isLoading: true,
    error: null,
  }),

  actions: {
    async fetchQuestion(context: EssayContext = essayFlowService.readContext()) {
      this.isLoading = true;
      this.error = null;
      try {
        this.context = context;
        const state = await essayRepository.getState(context);
        this.question = state.question;
        this.submission.content = state.draft;
        this.submission.feedback = state.feedback;
        this.history = state.history;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.isLoading = false;
      }
    },

    updateContent(content: string) {
      this.submission.content = content;
      this.submission.feedback = null;
      this.submitMessage = '';
      void essayRepository.saveDraft(content, this.context || essayFlowService.readContext());
    },

    async submitForGrading() {
      this.submission.isSubmitting = true;
      this.submission.feedback = null;
      this.submitMessage = '';
      try {
        await essayFlowService.enqueueGrading(this.submission.content, this.context || essayFlowService.readContext());
        this.submitMessage = '批改任务已提交，可在任务栏查看进度。';
      } finally {
        this.submission.isSubmitting = false;
      }
    },

    async resetDraft() {
      const state = await essayRepository.resetDraft(this.context || essayFlowService.readContext());
      this.submission.content = state.draft;
      this.submission.feedback = state.feedback;
      this.history = state.history;
      this.submitMessage = '';
    },

    reset() {
      this.question = null;
      this.submission.isSubmitting = false;
      this.context = null;
      this.submitMessage = '';
      this.isLoading = true;
    }
  },
});
