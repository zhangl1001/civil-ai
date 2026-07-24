import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { AIMessage, AIMessageRole, AISession } from '@/domain/ai';

export const AI_MESSAGE_CHANGED_EVENT = 'zhangl-ai-message-changed';

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function notifyMessageChanged(sessionId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AI_MESSAGE_CHANGED_EVENT, { detail: { sessionId } }));
}

export class AIChatRepository {
  async getLatestSession(projectId: string): Promise<AISession | undefined> {
    const sessions = await database.queryByIndex<AISession>(STORES.aiSessions, 'projectId', projectId);
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  async listSessions(projectId: string): Promise<AISession[]> {
    const sessions = await database.queryByIndex<AISession>(STORES.aiSessions, 'projectId', projectId);
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async createSession(projectId: string, title = '新会话'): Promise<AISession> {
    const now = Date.now();
    const session: AISession = {
      id: id('ai_session'),
      projectId,
      title,
      createdAt: now,
      updatedAt: now
    };
    await database.put<AISession>(STORES.aiSessions, session);
    notifyMessageChanged(session.id);
    return session;
  }

  async getOrCreateSession(projectId: string): Promise<AISession> {
    const existing = await this.getLatestSession(projectId);
    if (existing) return existing;

    return this.createSession(projectId, 'AI 助手');
  }

  async getSession(sessionId: string): Promise<AISession | undefined> {
    return database.get<AISession>(STORES.aiSessions, sessionId);
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;
    await database.put<AISession>(STORES.aiSessions, { ...session, title, updatedAt: Date.now() });
    notifyMessageChanged(sessionId);
  }

  async updateSessionSummary(sessionId: string, summary: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;
    const now = Date.now();
    await database.put<AISession>(STORES.aiSessions, {
      ...session,
      summary: summary.trim() || undefined,
      summaryUpdatedAt: now,
      updatedAt: now
    });
    notifyMessageChanged(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const messages = await this.listMessages(sessionId);
    await Promise.all(messages.map((message) => database.delete(STORES.aiMessages, message.id)));
    await database.delete(STORES.aiSessions, sessionId);
    notifyMessageChanged(sessionId);
  }

  async listMessages(sessionId: string): Promise<AIMessage[]> {
    const messages = await database.queryByIndex<AIMessage>(STORES.aiMessages, 'sessionId', sessionId);
    return messages.sort((a, b) => a.createdAt - b.createdAt);
  }

  async addMessage(input: {
    sessionId: string;
    role: AIMessageRole;
    content: string;
    toolName?: string;
    toolCallId?: string;
  }): Promise<AIMessage> {
    const now = Date.now();
    const message: AIMessage = {
      id: id('ai_message'),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      createdAt: now
    };
    await database.put<AIMessage>(STORES.aiMessages, message);
    const session = await database.get<AISession>(STORES.aiSessions, input.sessionId);
    if (session) {
      await database.put<AISession>(STORES.aiSessions, { ...session, updatedAt: now });
    }
    notifyMessageChanged(input.sessionId);
    return message;
  }

  async updateMessageContent(messageId: string, content: string): Promise<AIMessage | undefined> {
    const message = await database.get<AIMessage>(STORES.aiMessages, messageId);
    if (!message) return undefined;
    const next: AIMessage = { ...message, content };
    await database.put<AIMessage>(STORES.aiMessages, next);
    const session = await database.get<AISession>(STORES.aiSessions, message.sessionId);
    if (session) {
      await database.put<AISession>(STORES.aiSessions, { ...session, updatedAt: Date.now() });
    }
    notifyMessageChanged(message.sessionId);
    return next;
  }

  async updateMessageMeta(messageId: string, patch: Partial<Pick<AIMessage, 'content' | 'toolName' | 'toolCallId'>>): Promise<AIMessage | undefined> {
    const message = await database.get<AIMessage>(STORES.aiMessages, messageId);
    if (!message) return undefined;
    const next: AIMessage = { ...message, ...patch };
    await database.put<AIMessage>(STORES.aiMessages, next);
    const session = await database.get<AISession>(STORES.aiSessions, message.sessionId);
    if (session) {
      await database.put<AISession>(STORES.aiSessions, { ...session, updatedAt: Date.now() });
    }
    notifyMessageChanged(message.sessionId);
    return next;
  }
}

export const aiChatRepository = new AIChatRepository();
