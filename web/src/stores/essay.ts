import { defineStore } from 'pinia';
import { essayRepository, type EssayHistoryRecord, type EssayLecture } from '@/services/EssayRepository';
import { essayFlowService, type EssayContext } from '@/services/EssayFlowService';
import { EssayDraftAutosave } from '@/services/EssayDraftAutosave';
import type { AgentRunView } from '@/modules/agent/public';

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

/** A past attempt shown read-only, so reviewing one never overwrites the live draft. */
export interface EssayAttemptPreview {
  id: string;
  title: string;
  content: string;
  feedback: string;
  createdAt: number;
}

export interface EssayState {
  question: EssayQuestion | null;
  submission: EssaySubmission;
  history: EssayHistoryRecord[];
  preview: EssayAttemptPreview | null;
  context: EssayContext | null;
  submitMessage: string;
  isLoading: boolean;
  error: string | null;
}

const draftAutosave = new EssayDraftAutosave(
  (draft, context) => essayRepository.saveDraft(draft, context),
  180,
  (cause) => console.warn('[Essay] draft autosave failed', cause)
);

export const useEssayStore = defineStore('essay', {
  state: (): EssayState => ({
    question: null,
    submission: {
      content: '',
      feedback: null,
      isSubmitting: false,
    },
    history: [],
    preview: null,
    context: null,
    submitMessage: '',
    isLoading: true,
    error: null,
  }),

  actions: {
    async fetchQuestion(context: EssayContext) {
      this.isLoading = true;
      this.error = null;
      // The pending draft belongs to the set being left, so it must land before switching.
      await draftAutosave.flush();
      try {
        this.context = context;
        this.preview = null;
        this.applyState(await essayRepository.getState(context));
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.isLoading = false;
      }
    },

    /**
     * Brings grading results in without disturbing the answer being written: the in-memory
     * draft is authoritative while the page is open, so a background reload never reassigns it.
     */
    async refresh() {
      const context = this.context;
      if (!context) return;
      try {
        await draftAutosave.flush();
        const state = await essayRepository.getState(context);
        this.question = state.question;
        this.submission.feedback = state.feedback;
        this.history = state.history;
        this.error = null;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },

    reportError(cause: unknown) {
      this.error = cause instanceof Error ? cause.message : String(cause);
    },

    updateContent(content: string) {
      this.submission.content = content;
      this.submission.feedback = null;
      this.submitMessage = '';
      draftAutosave.schedule(content, requireEssayContext(this.context));
    },

    async submitForGrading(): Promise<AgentRunView | undefined> {
      this.submission.isSubmitting = true;
      this.submission.feedback = null;
      this.submitMessage = '';
      this.error = null;
      try {
        const context = requireEssayContext(this.context);
        await draftAutosave.flush();
        const result = await essayFlowService.enqueueGrading(this.submission.content, context);
        this.submitMessage = result.reused
          ? '本题组已有批改任务在执行，正在等待结果。'
          : '批改任务已提交，完成后会自动显示。';
        return result.task;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return undefined;
      } finally {
        this.submission.isSubmitting = false;
      }
    },

    async resetDraft() {
      // Clearing deliberately throws the pending keystrokes away rather than persisting them.
      draftAutosave.cancel();
      try {
        this.preview = null;
        this.applyState(await essayRepository.resetDraft(requireEssayContext(this.context)));
        this.submitMessage = '';
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },

    previewAttempt(item: EssayHistoryRecord) {
      this.preview = {
        id: item.id,
        title: item.title,
        content: item.content,
        feedback: item.feedback,
        createdAt: item.createdAt
      };
    },

    closePreview() {
      this.preview = null;
    },

    /** Leaves `preview` alone so a background refresh never closes what the reader is reading. */
    applyState(state: { question: EssayQuestion | null; draft: string; feedback: string | null; history: EssayHistoryRecord[] }) {
      this.question = state.question;
      this.submission.content = state.draft;
      this.submission.feedback = state.feedback;
      this.history = state.history;
    },

    reset(options: { loading?: boolean } = {}) {
      void draftAutosave.flush();
      this.question = null;
      this.submission = { content: '', feedback: null, isSubmitting: false };
      this.history = [];
      this.preview = null;
      this.context = null;
      this.submitMessage = '';
      this.isLoading = options.loading ?? false;
      this.error = null;
    }
  },
});

function requireEssayContext(context: EssayContext | null): EssayContext {
  if (!context) throw new Error('当前申论题组上下文已失效，请返回刷题中心重新进入。');
  return context;
}
