import type { AgentWorkspaceStorage } from '@/modules/agent/public';
import type { ConversationSession } from '../contracts/ConversationTypes';

interface SessionPutEntry {
  readonly version: 1;
  readonly operation: 'put';
  readonly session: ConversationSession;
}

interface SessionDeleteEntry {
  readonly version: 1;
  readonly operation: 'delete';
  readonly sessionId: string;
}

type SessionEntry = SessionPutEntry | SessionDeleteEntry;

const SESSION_INDEX_KEY = '__conversation_sessions__';

export class ConversationSessionLog {
  constructor(private readonly storage: AgentWorkspaceStorage) {}

  async get(sessionId: string): Promise<ConversationSession | undefined> {
    return (await this.replay()).get(sessionId);
  }

  async list(projectId: string): Promise<readonly ConversationSession[]> {
    return [...(await this.replay()).values()]
      .filter((session) => session.projectId === projectId)
      .sort((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id));
  }

  put(session: ConversationSession): Promise<void> {
    const entry: SessionPutEntry = { version: 1, operation: 'put', session };
    return this.storage.append(SESSION_INDEX_KEY, JSON.stringify(entry));
  }

  delete(sessionId: string): Promise<void> {
    const entry: SessionDeleteEntry = { version: 1, operation: 'delete', sessionId };
    return this.storage.append(SESSION_INDEX_KEY, JSON.stringify(entry));
  }

  private async replay(): Promise<Map<string, ConversationSession>> {
    const sessions = new Map<string, ConversationSession>();
    (await this.storage.read(SESSION_INDEX_KEY)).split('\n').forEach((line) => {
      const entry = parseEntry(line);
      if (!entry) return;
      if (entry.operation === 'delete') sessions.delete(entry.sessionId);
      else sessions.set(entry.session.id, entry.session);
    });
    return sessions;
  }
}

function parseEntry(line: string): SessionEntry | undefined {
  if (!line.trim()) return undefined;
  try {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const entry = value as Record<string, unknown>;
    if (entry.version !== 1) return undefined;
    if (entry.operation === 'delete' && typeof entry.sessionId === 'string') {
      return entry as unknown as SessionDeleteEntry;
    }
    if (entry.operation === 'put' && isSession(entry.session)) {
      return entry as unknown as SessionPutEntry;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function isSession(value: unknown): value is ConversationSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const session = value as Partial<ConversationSession>;
  return typeof session.id === 'string'
    && typeof session.projectId === 'string'
    && typeof session.title === 'string'
    && typeof session.createdAt === 'number'
    && typeof session.updatedAt === 'number';
}
