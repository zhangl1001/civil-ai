import type { Clock, IdGenerator, InstantMs } from '@/kernel/public';
import type { AgentMemoryRepository } from '@/modules/agent/public';
import type {
  ConversationMessage,
  ConversationRole,
  ConversationSession
} from '../contracts/ConversationTypes';
import { ConversationMessageLog } from './ConversationMessageLog';
import { ConversationSessionLog } from './ConversationSessionLog';

export class ConversationStore {
  constructor(
    private readonly sessionLog: ConversationSessionLog,
    private readonly messageLog: ConversationMessageLog,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly memories: AgentMemoryRepository
  ) {}

  async latestSession(projectId: string): Promise<ConversationSession | undefined> {
    return (await this.listSessions(projectId))[0];
  }

  async listSessions(projectId: string): Promise<readonly ConversationSession[]> {
    return this.sessionLog.list(projectId);
  }

  getSession(sessionId: string): Promise<ConversationSession | undefined> {
    return this.sessionLog.get(sessionId);
  }

  async createSession(projectId: string, title: string): Promise<ConversationSession> {
    const now = this.clock.now();
    const session: ConversationSession = {
      id: this.ids.next('ConversationSessionId'),
      projectId,
      title: title.trim() || '新会话',
      createdAt: now,
      updatedAt: now
    };
    await this.sessionLog.put(session);
    return session;
  }

  async updateSession(
    sessionId: string,
    patch: {
      readonly title?: string;
      readonly summary?: string;
      readonly summaryCursorMessageId?: string;
      readonly summaryVersion?: number;
    }
  ): Promise<ConversationSession | undefined> {
    const current = await this.sessionLog.get(sessionId);
    if (!current) return undefined;
    const now = this.clock.now();
    const next: ConversationSession = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title.trim() || current.title } : {}),
      ...(patch.summary !== undefined
        ? { summary: patch.summary.trim() || undefined, summaryUpdatedAt: now }
        : {}),
      ...(patch.summaryCursorMessageId !== undefined
        ? { summaryCursorMessageId: patch.summaryCursorMessageId || undefined }
        : {}),
      ...(patch.summaryVersion !== undefined ? { summaryVersion: patch.summaryVersion } : {}),
      updatedAt: now
    };
    await this.sessionLog.put(next);
    return next;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.memories.forgetSession(sessionId);
    await this.messageLog.deleteSession(sessionId);
    await this.sessionLog.delete(sessionId);
  }

  async deleteProjectConversations(projectId: string): Promise<number> {
    const sessions = await this.sessionLog.list(projectId);
    for (const session of sessions) await this.deleteSession(session.id);
    return sessions.length;
  }

  async replaceProjectConversations(
    projectId: string,
    sessions: readonly ConversationSession[],
    messages: readonly ConversationMessage[]
  ): Promise<number> {
    if (sessions.some((session) => session.projectId !== projectId)) {
      throw new Error('Conversation session belongs to another project');
    }
    const incomingSessionIds = new Set(sessions.map((session) => session.id));
    if (messages.some((message) => !incomingSessionIds.has(message.sessionId))) {
      throw new Error('Conversation message references a missing session');
    }

    const previousSessions = await this.sessionLog.list(projectId);
    const previousMessages = (await Promise.all(
      previousSessions.map((session) => this.messageLog.list(session.id))
    )).flat();
    const touchedSessionIds = new Set([
      ...previousSessions.map((session) => session.id),
      ...sessions.map((session) => session.id)
    ]);

    try {
      await this.replaceLogs(projectId, touchedSessionIds, sessions, messages);
    } catch (error) {
      await this.replaceLogs(projectId, touchedSessionIds, previousSessions, previousMessages)
        .catch((rollbackError) => {
          throw new AggregateError(
            [error, rollbackError],
            'Conversation import failed and rollback was incomplete'
          );
        });
      throw error;
    }

    await Promise.allSettled(
      previousSessions.map((session) => this.memories.forgetSession(session.id))
    );
    return sessions.length + messages.length;
  }

  listMessages(sessionId: string): Promise<readonly ConversationMessage[]> {
    return this.messageLog.list(sessionId);
  }

  async addMessage(input: {
    readonly sessionId: string;
    readonly role: ConversationRole;
    readonly content: string;
    readonly toolName?: string;
    readonly toolCallId?: string;
  }): Promise<ConversationMessage> {
    const session = await this.sessionLog.get(input.sessionId);
    if (!session) throw new Error('Conversation session does not exist');
    const now = this.clock.now();
    const message: ConversationMessage = {
      id: this.ids.next('ConversationMessageId'),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      createdAt: now
    };
    await this.messageLog.append(message);
    await this.sessionLog.put({ ...session, updatedAt: now });
    return message;
  }

  async updateMessage(
    sessionId: string,
    messageId: string,
    patch: Partial<Pick<ConversationMessage, 'content' | 'toolName' | 'toolCallId'>>
  ): Promise<ConversationMessage | undefined> {
    const message = await this.messageLog.get(sessionId, messageId);
    if (!message) return undefined;
    const next: ConversationMessage = { ...message, ...patch };
    await this.messageLog.replace(next);
    return next;
  }

  async restoreMessage(message: ConversationMessage): Promise<void> {
    const session = await this.sessionLog.get(message.sessionId);
    if (!session) throw new Error('Conversation session does not exist');
    await this.messageLog.replace(message);
  }

  async restoreSummary(sessionId: string, summary: string, updatedAt: InstantMs): Promise<void> {
    const session = await this.sessionLog.get(sessionId);
    if (!session) throw new Error('Conversation session does not exist');
    await this.sessionLog.put({ ...session, summary, summaryUpdatedAt: updatedAt });
  }

  async restoreSession(session: ConversationSession): Promise<void> {
    await this.sessionLog.put(session);
  }

  private async replaceLogs(
    projectId: string,
    touchedSessionIds: ReadonlySet<string>,
    sessions: readonly ConversationSession[],
    messages: readonly ConversationMessage[]
  ): Promise<void> {
    for (const sessionId of touchedSessionIds) await this.messageLog.deleteSession(sessionId);
    for (const session of await this.sessionLog.list(projectId)) {
      await this.sessionLog.delete(session.id);
    }
    for (const session of sessions) await this.sessionLog.put(session);
    for (const message of messages) await this.messageLog.replace(message);
  }
}
