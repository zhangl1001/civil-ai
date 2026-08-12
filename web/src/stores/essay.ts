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
  isLoading: boolean;
  error: string | null;
}

const draftAutosave = new EssayDraftAutosave(
  (draft, context) => essayRepository.saveDraft(draft, context),
  180,
  (cause) => console.warn('[Essay] draft autosave failed', cause)
);
let stateLoadRevision = 0;

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
    isLoading: true,
    error: null,
  }),

  actions: {
    async fetchQuestion(context: EssayContext) {
      const revision = ++stateLoadRevision;
      this.isLoading = true;
      this.error = null;
      // The pending draft belongs to the set being left, so it must land before switching.
      await draftAutosave.flush();
      if (revision !== stateLoadRevision) return;
      try {
        this.context = context;
        this.question = null;
        this.preview = null;
        this.submission = { content: '', feedback: null, isSubmitting: false };
        this.history = [];
        const state = await essayRepository.getState(context);
        if (revision !== stateLoadRevision || this.context?.questionSetId !== context.questionSetId) return;
        this.applyState(state);
      } catch (error) {
        if (revision !== stateLoadRevision) return;
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        if (revision === stateLoadRevision) this.isLoading = false;
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
        if (this.context?.questionSetId !== context.questionSetId) return;
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
      draftAutosave.schedule(content, requireEssayContext(this.context));
    },

    async submitForGrading(): Promise<AgentRunView | undefined> {
      this.submission.isSubmitting = true;
      this.submission.feedback = null;
      this.error = null;
      try {
        const context = requireEssayContext(this.context);
        await draftAutosave.flush();
        const result = await essayFlowService.enqueueGrading(this.submission.content, context);
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
      stateLoadRevision += 1;
      void draftAutosave.flush();
      this.question = null;
      this.submission = { content: '', feedback: null, isSubmitting: false };
      this.history = [];
      this.preview = null;
      this.context = null;
      this.isLoading = options.loading ?? false;
      this.error = null;
    }
  },
});

function requireEssayContext(context: EssayContext | null): EssayContext {
  if (!context) throw new Error('当前申论题组上下文已失效，请返回刷题中心重新进入。');
  return context;
}
