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

const initializations = new WeakMap<object, Promise<void>>();

interface ChatRequest {
  readonly sessionId: string;
  readonly text: string;
  readonly attachments?: readonly ModelImageContentPart[];
  readonly invocation?: AgentWorkflowInvocation;
  readonly guidance: string[];
}
const activeRequests = new WeakMap<object, ChatRequest>();
const retryRequests = new WeakMap<object, Map<string, ChatRequest>>();

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
  sessionRevision: number;
  messagesRevision: number;
  sessionsRevision: number;
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
    steeringCount: 0,
    sessionRevision: 0,
    messagesRevision: 0,
    sessionsRevision: 0
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
      const initializationPromise = initializations.get(this);
      if (initializationPromise) {
        await initializationPromise;
        return;
      }
      const revision = ++this.sessionRevision;
      this.isLoading = true;
      const pending = (async () => {
        const project = await projectRepository.getActiveProject();
        if (revision !== this.sessionRevision) return;
        const session = await aiChatRepository.getOrCreateSession(project.id);
        if (revision !== this.sessionRevision) return;
        this.applySession(session);
        await this.refreshMessages();
        await this.refreshSessions();
      })();
      initializations.set(this, pending);
      try {
        await pending;
      } finally {
        initializations.delete(this);
        this.isLoading = false;
        this.observeMessages();
      }
    },

    observeMessages() {
      if (this.initialized) return;
      this.initialized = true;
      window.addEventListener(AI_MESSAGE_CHANGED_EVENT, (event) => {
        const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
        if (detail?.sessionId && detail.sessionId !== this.session?.id) return;
        if (!this.isSending || detail?.sessionId !== this.activeSessionId) void this.refreshMessages();
        void this.refreshSessions();
      });
    },

    async refreshMessages() {
      if (!this.session) return;
      const sessionId = this.session.id;
      const revision = this.sessionRevision;
      const request = ++this.messagesRevision;
      this.isLoadingOlderMessages = false;
      const loadedCount = this.messages.filter(isPersistedMessage).length;
      const page = await aiChatRepository.listMessagePage(sessionId, {
        limit: Math.max(AI_CHAT_MESSAGE_PAGE_SIZE, loadedCount)
      });
      if (this.session?.id !== sessionId || revision !== this.sessionRevision || request !== this.messagesRevision) return;
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
      const sessionId = this.session.id;
      const revision = this.sessionRevision;
      const request = ++this.messagesRevision;
      this.isLoadingOlderMessages = true;
      try {
        const page = await aiChatRepository.listMessagePage(sessionId, {
          beforeMessageId: first.id
        });
        if (this.session?.id !== sessionId || revision !== this.sessionRevision || request !== this.messagesRevision) return 0;
        const existingIds = new Set(this.messages.map((message) => message.id));
        const older = page.messages.filter((message) => !existingIds.has(message.id));
        this.messages = [...older, ...this.messages];
        this.hasOlderMessages = page.hasMore;
        return older.length;
      } finally {
        if (revision === this.sessionRevision && request === this.messagesRevision) this.isLoadingOlderMessages = false;
      }
    },

    async refreshSessions() {
      const request = ++this.sessionsRevision;
      const project = await projectRepository.getActiveProject();
      const sessions = await aiChatRepository.listSessions(project.id);
      if (request === this.sessionsRevision) this.sessions = sessions;
    },

    async newSession(title = '新会话') {
      const revision = this.beginSessionSelection();
      const project = await projectRepository.getActiveProject();
      if (revision !== this.sessionRevision) return;
      const session = await aiChatRepository.createSession(project.id, title);
      if (revision !== this.sessionRevision) return;
      this.applySession(session);
      await this.refreshSessions();
    },

    async switchSession(sessionId: string) {
      const revision = this.beginSessionSelection();
      const session = await aiChatRepository.getSession(sessionId);
      if (!session || revision !== this.sessionRevision) return;
      this.applySession(session);
      await this.refreshMessages();
      await this.refreshSessions();
    },

    beginSessionSelection() {
      this.sessionRevision += 1;
      this.messagesRevision += 1;
      this.isLoadingOlderMessages = false;
      return this.sessionRevision;
    },

    applySession(session: AISession) {
      this.session = session;
      this.messagesRevision += 1;
      this.messages = [];
      this.hasOlderMessages = false;
      this.isLoadingOlderMessages = false;
      this.streamingMessageId = '';
      this.provisionalMessageId = '';
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
      const sessionId = this.session.id;
      const revision = this.sessionRevision;
      const request = activeRequests.get(this);
      const guidanceIndex = request?.guidance.length ?? 0;
      request?.guidance.push(text);
      const message = await chatAgentService.steer(text, this.session).catch((error: unknown) => {
        request?.guidance.splice(guidanceIndex, 1);
        throw error;
      });
      if (!message) request?.guidance.splice(guidanceIndex, 1);
      if (!message) return false;
      if (this.session?.id !== sessionId || revision !== this.sessionRevision) return true;
      this.steeringCount += 1;
      if (!this.messages.some((item) => item.id === message.id)) {
        this.messages.push(message);
      }
      return true;
    },

    async send(
      content: string,
      attachments?: readonly ModelImageContentPart[],
      invocation?: AgentWorkflowInvocation,
      guidance: readonly string[] = []
    ) {
      const text = content.trim();
      if (!text || this.isSending) return;
      await this.init();
      if (!this.session || this.isSending) return;
      const activeSession = this.session;
      const revision = this.sessionRevision;
      const request: ChatRequest = {
        sessionId: activeSession.id, text,
        attachments: attachments?.map((part) => ({ ...part })),
        invocation: invocation ? { ...invocation, skillNames: invocation.skillNames ? [...invocation.skillNames] : undefined } : undefined,
        guidance: [...guidance]
      };
      activeRequests.set(this, request);
      const prompt = [text, ...guidance.map((item) => `【用户在执行中补充的引导】\n${item}`)].join('\n\n');
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
          content: prompt,
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
          if (this.session?.id === activeSession.id && revision === this.sessionRevision) this.session = { ...activeSession, title };
          await this.refreshSessions();
        }
        const routed = await chatAgentService.handle(prompt, activeSession, {
          thinkingEnabled: this.thinkingEnabled,
          attachments: request.attachments,
          invocation: request.invocation,
          onAssistantStream: async (update) => {
            if (update.status) {
              const retries = retryRequests.get(this) ?? new Map<string, ChatRequest>();
              retries.set(update.messageId, request);
              retryRequests.set(this, retries);
              await aiChatRepository.updateMessageMeta(activeSession.id, update.messageId, {
                retryRequest: { text: request.text, invocation: request.invocation, guidance: [...request.guidance] }
              });
            }
            this.applyAssistantStream(update);
          }
        });
        if (!routed.handled) throw new Error('AI Agent 未接管当前消息');
        delivered = true;
        if (this.session?.id === activeSession.id) await this.refreshMessages();
        const refreshedSession = await aiChatRepository.getSession(activeSession.id);
        if (refreshedSession && this.session?.id === activeSession.id && revision === this.sessionRevision) {
          this.session = refreshedSession;
        }
        await this.refreshSessions();
      } finally {
        activeRequests.delete(this);
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
      const failed = this.messages[index];
      if (!failed?.status || failed.sessionId !== this.session?.id) return;
      const cached = retryRequests.get(this)?.get(messageId);
      const previous = failed.retryRequest ?? cached;
      if (previous) {
        await this.send(previous.text, cached?.attachments, previous.invocation, previous.guidance);
        return;
      }
      // Legacy rows lack metadata: keep consecutive guidance with the original question.
      const revision = this.sessionRevision;
      const history = await aiChatRepository.listMessages(failed.sessionId);
      if (revision !== this.sessionRevision || this.session?.id !== failed.sessionId) return;
      const questions: string[] = [];
      for (let cursor = history.findIndex((item) => item.id === messageId) - 1; cursor >= 0 && history[cursor]?.role === 'user'; cursor -= 1) {
        questions.unshift(history[cursor]!.content);
      }
      if (questions[0]?.trim()) await this.send(questions[0], undefined, undefined, questions.slice(1));
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
      const revision = this.sessionRevision;
      const session = await aiChatRepository.getSession(sessionId);
      if (session && this.session?.id === sessionId && revision === this.sessionRevision) this.session = session;
    }
  }
});

function isPersistedMessage(message: AIChatMessage): boolean {
  return !message.id.startsWith('optimistic-user:') && !message.id.startsWith('pending-assistant:');
}
