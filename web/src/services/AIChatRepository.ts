import { initializeTutorRuntime } from '@/composition-root/public';
import type { AIMessage, AIMessageRole, AISession } from '@/domain/ai';
import { agentToolActivityService } from './AgentToolActivityService';

export const AI_MESSAGE_CHANGED_EVENT = 'zhangl-ai-message-changed';

function notifyMessageChanged(sessionId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AI_MESSAGE_CHANGED_EVENT, { detail: { sessionId } }));
}

export class AIChatRepository {
  async getLatestSession(projectId: string): Promise<AISession | undefined> {
    const runtime = await initializeTutorRuntime();
    return runtime.conversationStore.latestSession(projectId) as Promise<AISession | undefined>;
  }

  async listSessions(projectId: string): Promise<AISession[]> {
    const runtime = await initializeTutorRuntime();
    return [...await runtime.conversationStore.listSessions(projectId)] as AISession[];
  }

  async createSession(projectId: string, title = '新会话'): Promise<AISession> {
    const runtime = await initializeTutorRuntime();
    const session = await runtime.conversationStore.createSession(projectId, title);
    notifyMessageChanged(session.id);
    return session as AISession;
  }

  async getOrCreateSession(projectId: string): Promise<AISession> {
    const existing = await this.getLatestSession(projectId);
    if (existing) return existing;

    return this.createSession(projectId, 'AI 助手');
  }

  async getSession(sessionId: string): Promise<AISession | undefined> {
    const runtime = await initializeTutorRuntime();
    return runtime.conversationStore.getSession(sessionId) as Promise<AISession | undefined>;
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    const runtime = await initializeTutorRuntime();
    await runtime.conversationStore.updateSession(sessionId, { title });
    notifyMessageChanged(sessionId);
  }

  async updateSessionSummary(sessionId: string, summary: string): Promise<void> {
    const runtime = await initializeTutorRuntime();
    await runtime.conversationStore.updateSession(sessionId, { summary });
    notifyMessageChanged(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const runtime = await initializeTutorRuntime();
    await runtime.conversationStore.deleteSession(sessionId);
    agentToolActivityService.clear(sessionId);
    notifyMessageChanged(sessionId);
  }

  async listMessages(sessionId: string): Promise<AIMessage[]> {
    const runtime = await initializeTutorRuntime();
    return [...await runtime.conversationStore.listMessages(sessionId)]
      .filter((message) => message.role !== 'tool') as AIMessage[];
  }

  async addMessage(input: {
    sessionId: string;
    role: AIMessageRole;
    content: string;
    toolName?: string;
    toolCallId?: string;
  }): Promise<AIMessage> {
    const runtime = await initializeTutorRuntime();
    const message = await runtime.conversationStore.addMessage(input);
    notifyMessageChanged(input.sessionId);
    return message as AIMessage;
  }

  async updateMessageContent(sessionId: string, messageId: string, content: string): Promise<AIMessage | undefined> {
    const runtime = await initializeTutorRuntime();
    const next = await runtime.conversationStore.updateMessage(sessionId, messageId, { content });
    notifyMessageChanged(next?.sessionId);
    return next as AIMessage | undefined;
  }

  async updateMessageMeta(
    sessionId: string,
    messageId: string,
    patch: Partial<Pick<AIMessage, 'content' | 'toolName' | 'toolCallId'>>
  ): Promise<AIMessage | undefined> {
    const runtime = await initializeTutorRuntime();
    const next = await runtime.conversationStore.updateMessage(sessionId, messageId, patch);
    notifyMessageChanged(next?.sessionId);
    return next as AIMessage | undefined;
  }
}

export const aiChatRepository = new AIChatRepository();
