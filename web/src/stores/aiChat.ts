import { defineStore } from 'pinia';
import type { AIMessage, AISession } from '@/domain/ai';
import { aiEngine } from '@/ai/AIEngine';
import type { AICompletionMessage } from '@/ai/AIProvider';
import { buildChatContext, buildConversationSummary } from '@/ai/ChatContextBuilder';
import { buildCompanionChatPrompt } from '@/ai/prompts';
import { AI_MESSAGE_CHANGED_EVENT, aiChatRepository } from '@/services/AIChatRepository';
import { aiCommandRouter } from '@/services/AICommandRouter';
import { aiStudentContextService } from '@/services/AIStudentContextService';
import { projectRepository } from '@/services/ProjectRepository';
import { TASK_CHANGED_EVENT } from '@/tasks/TaskStore';

let activeController: AbortController | null = null;

export interface AIChatState {
  isOpen: boolean;
  isLoading: boolean;
  isSending: boolean;
  streamingMessageId: string;
  initialized: boolean;
  session: AISession | null;
  sessions: AISession[];
  messages: AIMessage[];
  thinkingEnabled: boolean;
}

export const useAIChatStore = defineStore('aiChat', {
  state: (): AIChatState => ({
    isOpen: false,
    isLoading: false,
    isSending: false,
    streamingMessageId: '',
    initialized: false,
    session: null,
    sessions: [],
    messages: [],
    thinkingEnabled: localStorage.getItem('ai-thinking-enabled') === '1'
  }),

  getters: {
    hasMessages(state): boolean {
      return state.messages.length > 0;
    },
    sessionTitle(state): string {
      return state.session?.title || '新会话';
    }
  },

  actions: {
    async open(prompt?: string) {
      this.isOpen = true;
      await this.init();
      if (prompt) await this.send(prompt);
    },

    close() {
      this.isOpen = false;
    },

    async init() {
      if (this.session || this.isLoading) return;
      this.isLoading = true;
      try {
        const project = await projectRepository.getActiveProject();
        this.session = await aiChatRepository.getOrCreateSession(project.id);
        this.sessions = await aiChatRepository.listSessions(project.id);
        this.messages = await aiChatRepository.listMessages(this.session.id);
        if (!this.initialized) {
          this.initialized = true;
          window.addEventListener(TASK_CHANGED_EVENT, () => {
            void this.refreshMessages();
          });
          window.addEventListener(AI_MESSAGE_CHANGED_EVENT, (event) => {
            const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
            if (detail?.sessionId && detail.sessionId !== this.session?.id) return;
            void this.refreshMessages();
            void this.refreshSessions();
          });
        }
      } finally {
        this.isLoading = false;
      }
    },

    async refreshMessages() {
      if (!this.session) return;
      this.messages = await aiChatRepository.listMessages(this.session.id);
    },

    async refreshSessions() {
      const project = await projectRepository.getActiveProject();
      this.sessions = await aiChatRepository.listSessions(project.id);
    },

    async newSession(title = '新会话') {
      const project = await projectRepository.getActiveProject();
      this.session = await aiChatRepository.createSession(project.id, title);
      this.messages = [];
      await this.refreshSessions();
    },

    async switchSession(sessionId: string) {
      const session = await aiChatRepository.getSession(sessionId);
      if (!session) return;
      this.session = session;
      this.messages = await aiChatRepository.listMessages(session.id);
      await this.refreshSessions();
    },

    async deleteOtherSessions() {
      if (!this.session) return;
      await Promise.all(this.sessions.filter((session) => session.id !== this.session?.id).map((session) => aiChatRepository.deleteSession(session.id)));
      await this.refreshSessions();
    },

    setThinkingEnabled(value: boolean) {
      this.thinkingEnabled = value;
      localStorage.setItem('ai-thinking-enabled', value ? '1' : '0');
    },

    cancelResponse() {
      activeController?.abort();
    },

    async send(content: string) {
      const text = content.trim();
      if (!text || this.isSending) return;
      await this.init();
      if (!this.session) return;

      this.isSending = true;
      try {
        const shouldRename = this.messages.length === 0 && (!this.session.title || ['AI 助手', '新会话'].includes(this.session.title));
        if (shouldRename) {
          const title = text.length > 14 ? `${text.slice(0, 14)}...` : text;
          await aiChatRepository.updateSessionTitle(this.session.id, title);
          this.session = { ...this.session, title };
          await this.refreshSessions();
        }
        const routed = await aiCommandRouter.handle(text, this.session);
        if (routed.handled) {
          await this.refreshMessages();
          await this.refreshSessions();
          return;
        }
        const userMessage = await aiChatRepository.addMessage({
          sessionId: this.session.id,
          role: 'user',
          content: text
        });
        this.messages.push(userMessage);

        const studentContext = await aiStudentContextService.buildSystemContext();
        const systemPrompt = buildCompanionChatPrompt(this.thinkingEnabled, studentContext, this.session.summary || '');
        const history = buildChatContext(this.messages, { currentPrompt: text });
        const assistantMessage = await aiChatRepository.addMessage({
          sessionId: this.session.id,
          role: 'assistant',
          content: ''
        });
        this.messages.push(assistantMessage);
        this.streamingMessageId = assistantMessage.id;

        activeController = new AbortController();
        let answer = '';
        let lastFlush = 0;
        const messages: AICompletionMessage[] = [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: text }
        ];

        try {
          await aiEngine.stream(messages, async (delta) => {
            answer += delta;
            const local = this.messages.find((message) => message.id === assistantMessage.id);
            if (local) local.content = answer;
            const now = Date.now();
            if (now - lastFlush < 220 && answer.length > 24) return;
            lastFlush = now;
            await aiChatRepository.updateMessageContent(assistantMessage.id, answer);
          }, activeController.signal);
          await aiChatRepository.updateMessageContent(assistantMessage.id, answer);
          const local = this.messages.find((message) => message.id === assistantMessage.id);
          if (local) local.content = answer;
          await this.updateCurrentSessionSummary();
        } catch (error) {
          const aborted = activeController.signal.aborted;
          const fallback = aborted ? `${answer}\n\n[[ZH_AI_STOPPED]]`.trim() : `回复失败：${error instanceof Error ? error.message : String(error)}`;
          const local = this.messages.find((message) => message.id === assistantMessage.id);
          if (local) local.content = fallback;
          await aiChatRepository.updateMessageContent(assistantMessage.id, fallback);
        } finally {
          activeController = null;
          this.streamingMessageId = '';
          await this.refreshSessions();
        }
      } finally {
        this.isSending = false;
      }
    },

    async updateCurrentSessionSummary() {
      if (!this.session) return;
      const summary = buildConversationSummary(this.messages);
      await aiChatRepository.updateSessionSummary(this.session.id, summary);
      this.session = { ...this.session, summary, summaryUpdatedAt: Date.now() };
    }
  }
});
