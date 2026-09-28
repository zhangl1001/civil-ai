import { defineStore } from 'pinia';
import type { AISession } from '@/domain/ai';
import {
  AI_MESSAGE_CHANGED_EVENT,
  aiChatRepository,
  type AIChatMessage
} from '@/services/AIChatRepository';
import { AI_CHAT_MESSAGE_PAGE_SIZE } from '@/ai/ChatMessagePagination';
import {
  chatAgentService,
  type ChatAssistantStreamUpdate
} from '@/services/ChatAgentService';
import { projectRepository } from '@/services/ProjectRepository';
import type { ModelImageContentPart } from '@/capabilities/ai-runtime/public';
import type { AgentWorkflowInvocation } from '@/modules/agent/public';

let initializationPromise: Promise<void> | undefined;

export interface AIChatState {
  isOpen: boolean;
  isLoading: boolean;
  isSending: boolean;
  streamingMessageId: string;
  /** Streaming bubble whose text came from a turn that went on to call tools. */
  provisionalMessageId: string;
  pendingAssistantMessageId: string;
  initialized: boolean;
  session: AISession | null;
  sessions: AISession[];
  messages: AIChatMessage[];
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  thinkingEnabled: boolean;
  activeRequestText: string;
  activeSessionId: string;
  steeringCount: number;
}

export const useAIChatStore = defineStore('aiChat', {
  state: (): AIChatState => ({
    isOpen: false,
    isLoading: false,
    isSending: false,
    streamingMessageId: '',
    provisionalMessageId: '',
    pendingAssistantMessageId: '',
    initialized: false,
    session: null,
    sessions: [],
    messages: [],
    hasOlderMessages: false,
    isLoadingOlderMessages: false,
    thinkingEnabled: localStorage.getItem('ai-thinking-enabled') === '1',
    activeRequestText: '',
    activeSessionId: '',
    steeringCount: 0
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
    async open(
      prompt?: string,
      attachments?: readonly ModelImageContentPart[],
      invocation?: AgentWorkflowInvocation
    ) {
      this.isOpen = true;
      await this.init();
      if (prompt) await this.send(prompt, attachments, invocation);
    },

    close() {
      this.isOpen = false;
    },

    async init() {
      if (this.session) return;
      if (initializationPromise) {
        await initializationPromise;
        return;
      }
      this.isLoading = true;
      initializationPromise = (async () => {
        const project = await projectRepository.getActiveProject();
        this.session = await aiChatRepository.getOrCreateSession(project.id);
        this.sessions = await aiChatRepository.listSessions(project.id);
        const page = await aiChatRepository.listMessagePage(this.session.id);
        this.messages = [...page.messages];
        this.hasOlderMessages = page.hasMore;
        if (!this.initialized) {
          this.initialized = true;
          window.addEventListener(AI_MESSAGE_CHANGED_EVENT, (event) => {
            const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
            if (detail?.sessionId && detail.sessionId !== this.session?.id) return;
            if (
              this.isSending
              && detail?.sessionId
              && detail.sessionId === this.activeSessionId
            ) {
              void this.refreshSessions();
              return;
            }
            void this.refreshMessages();
            void this.refreshSessions();
          });
        }
      })();
      try {
        await initializationPromise;
      } finally {
        initializationPromise = undefined;
        this.isLoading = false;
      }
    },

    async refreshMessages() {
      if (!this.session) return;
      const loadedCount = this.messages.filter(isPersistedMessage).length;
      const page = await aiChatRepository.listMessagePage(this.session.id, {
        limit: Math.max(AI_CHAT_MESSAGE_PAGE_SIZE, loadedCount)
      });
      const messages = [...page.messages];
      const isActiveSession = this.isSending && this.activeSessionId === this.session.id;
      if (isActiveSession && this.pendingAssistantMessageId) {
        messages.push({
          id: this.pendingAssistantMessageId,
          sessionId: this.session.id,
          role: 'assistant',
          content: '',
          createdAt: Date.now()
        });
      }
      this.messages = messages;
      this.hasOlderMessages = page.hasMore;
      this.streamingMessageId = isActiveSession ? this.pendingAssistantMessageId : '';
    },

    async loadOlderMessages(): Promise<number> {
      if (!this.session || !this.hasOlderMessages || this.isLoadingOlderMessages) return 0;
      const first = this.messages.find(isPersistedMessage);
      if (!first) return 0;
      this.isLoadingOlderMessages = true;
      try {
        const page = await aiChatRepository.listMessagePage(this.session.id, {
          beforeMessageId: first.id
        });
        const existingIds = new Set(this.messages.map((message) => message.id));
        const older = page.messages.filter((message) => !existingIds.has(message.id));
        this.messages = [...older, ...this.messages];
        this.hasOlderMessages = page.hasMore;
        return older.length;
      } finally {
        this.isLoadingOlderMessages = false;
      }
    },

    async refreshSessions() {
      const project = await projectRepository.getActiveProject();
      this.sessions = await aiChatRepository.listSessions(project.id);
    },

    async newSession(title = '新会话') {
      const project = await projectRepository.getActiveProject();
      this.session = await aiChatRepository.createSession(project.id, title);
      this.messages = [];
      this.hasOlderMessages = false;
      await this.refreshSessions();
    },

    async switchSession(sessionId: string) {
      const session = await aiChatRepository.getSession(sessionId);
      if (!session) return;
      this.session = session;
      const page = await aiChatRepository.listMessagePage(session.id);
      this.messages = [...page.messages];
      this.hasOlderMessages = page.hasMore;
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
      chatAgentService.cancel(this.activeSessionId || this.session?.id);
    },

    async steer(content: string): Promise<boolean> {
      const text = content.trim();
      if (
        !text
        || !this.isSending
        || !this.session
        || this.session.id !== this.activeSessionId
      ) return false;
      const message = await chatAgentService.steer(text, this.session);
      if (!message) return false;
      this.steeringCount += 1;
      if (!this.messages.some((item) => item.id === message.id)) {
        this.messages.push(message);
      }
      return true;
    },

    async send(
      content: string,
      attachments?: readonly ModelImageContentPart[],
      invocation?: AgentWorkflowInvocation
    ) {
      const text = content.trim();
      if (!text || this.isSending) return;
      await this.init();
      if (!this.session) return;
      const activeSession = this.session;
      const shouldRename = this.messages.length === 0
        && (!activeSession.title || ['AI 助手', '新会话'].includes(activeSession.title));

      this.isSending = true;
      this.activeSessionId = activeSession.id;
      const optimisticUserId = `optimistic-user:${crypto.randomUUID()}`;
      this.pendingAssistantMessageId = `pending-assistant:${crypto.randomUUID()}`;
      this.messages.push(
        {
          id: optimisticUserId,
          sessionId: activeSession.id,
          role: 'user',
          content: text,
          createdAt: Date.now()
        },
        {
          id: this.pendingAssistantMessageId,
          sessionId: activeSession.id,
          role: 'assistant',
          content: '',
          createdAt: Date.now() + 1
        }
      );
      this.streamingMessageId = this.pendingAssistantMessageId;
      this.activeRequestText = text;
      this.steeringCount = 0;
      let delivered = false;
      try {
        if (shouldRename) {
          const title = text.length > 14 ? `${text.slice(0, 14)}...` : text;
          await aiChatRepository.updateSessionTitle(activeSession.id, title);
          if (this.session?.id === activeSession.id) this.session = { ...activeSession, title };
          await this.refreshSessions();
        }
        const routed = await chatAgentService.handle(text, activeSession, {
          thinkingEnabled: this.thinkingEnabled,
          attachments,
          invocation,
          onAssistantStream: (update) => this.applyAssistantStream(update)
        });
        if (!routed.handled) throw new Error('AI Agent 未接管当前消息');
        delivered = true;
        await this.refreshMessages();
        const refreshedSession = await aiChatRepository.getSession(activeSession.id);
        if (refreshedSession && this.session?.id === activeSession.id) {
          this.session = refreshedSession;
        }
        await this.refreshSessions();
      } finally {
        const pendingAssistantMessageId = this.pendingAssistantMessageId;
        this.isSending = false;
        this.streamingMessageId = '';
        this.provisionalMessageId = '';
        this.pendingAssistantMessageId = '';
        this.activeSessionId = '';
        this.activeRequestText = '';
        this.steeringCount = 0;
        // A request that threw never reached the conversation: drop its optimistic
        // rows so the composer can offer the draft again.
        this.messages = this.messages.filter((message) => (
          message.id !== pendingAssistantMessageId && (delivered || message.id !== optimisticUserId)
        ));
      }
    },

    /** Sends the question of a failed or stopped turn again. */
    async retry(messageId: string) {
      if (this.isSending) return;
      const index = this.messages.findIndex((message) => message.id === messageId);
      const question = this.messages.slice(0, Math.max(0, index)).reverse().find((message) => message.role === 'user');
      if (index < 0 || !question?.content.trim()) return;
      await this.send(question.content);
    },

    applyAssistantStream(update: ChatAssistantStreamUpdate) {
      if (!this.session || this.session.id !== update.sessionId) return;
      const replaceMessageId = update.replaceMessageId || this.pendingAssistantMessageId;
      const replacementIndex = replaceMessageId
        ? this.messages.findIndex((message) => message.id === replaceMessageId)
        : -1;
      const messageIndex = this.messages.findIndex((message) => message.id === update.messageId);
      const targetIndex = replacementIndex >= 0 ? replacementIndex : messageIndex;
      const previous = targetIndex >= 0 ? this.messages[targetIndex] : undefined;
      const message: AIChatMessage = {
        id: update.messageId,
        sessionId: this.session.id,
        role: 'assistant',
        content: update.content,
        toolCallId: previous?.toolCallId,
        ...(update.status ? { status: update.status } : {}),
        ...(update.errorCode ? { errorCode: update.errorCode } : {}),
        ...(update.errorMessage ? { errorMessage: update.errorMessage } : {}),
        createdAt: previous?.createdAt ?? Date.now()
      };
      if (targetIndex >= 0) this.messages.splice(targetIndex, 1, message);
      else this.messages.push(message);
      if (replacementIndex >= 0 && messageIndex >= 0 && messageIndex !== replacementIndex) {
        const duplicateIndex = this.messages.findIndex((item, index) => index !== targetIndex && item.id === update.messageId);
        if (duplicateIndex >= 0) this.messages.splice(duplicateIndex, 1);
      }
      if (replacementIndex >= 0 && replaceMessageId === this.pendingAssistantMessageId) {
        this.pendingAssistantMessageId = '';
      }
      this.provisionalMessageId = update.provisional ? update.messageId : '';
      this.streamingMessageId = update.messageId;
    },

    async updateCurrentSessionSummary() {
      if (!this.session) return;
      await this.updateSessionSummary(this.session.id);
    },

    async updateSessionSummary(sessionId: string) {
      const session = await aiChatRepository.getSession(sessionId);
      if (session && this.session?.id === sessionId) this.session = session;
    }
  }
});

function isPersistedMessage(message: AIChatMessage): boolean {
  return !message.id.startsWith('optimistic-user:') && !message.id.startsWith('pending-assistant:');
}
