import type { ConversationMessage } from '../contracts/ConversationTypes';
import type { AgentWorkspaceStorage } from '@/modules/agent/public';

interface ConversationMessageLogEntry {
  readonly version: 1;
  readonly operation: 'put';
  readonly message: ConversationMessage;
}

export class ConversationMessageLog {
  private readonly pending = new Map<string, Promise<void>>();

  constructor(private readonly storage: AgentWorkspaceStorage) {}

  async list(sessionId: string): Promise<readonly ConversationMessage[]> {
    await this.pending.get(sessionId);
    return this.readMessages(sessionId);
  }

  private async readMessages(sessionId: string): Promise<readonly ConversationMessage[]> {
    const messages = new Map<string, ConversationMessage>();
    (await this.entries(sessionId)).forEach((entry) => {
      if (entry.message.sessionId !== sessionId) return;
      messages.set(entry.message.id, entry.message);
    });
    return [...messages.values()]
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  }

  private async entries(sessionId: string): Promise<readonly ConversationMessageLogEntry[]> {
    const entries: ConversationMessageLogEntry[] = [];
    (await this.storage.read(sessionId)).split('\n').forEach((line) => {
      const entry = parseEntry(line);
      if (entry) entries.push(entry);
    });
    return entries;
  }

  async get(sessionId: string, messageId: string): Promise<ConversationMessage | undefined> {
    return (await this.list(sessionId)).find((message) => message.id === messageId);
  }

  append(message: ConversationMessage): Promise<void> {
    return this.enqueue(message.sessionId, () => (
      this.storage.append(message.sessionId, serialize(message))
    ));
  }

  replace(message: ConversationMessage): Promise<void> {
    return this.enqueue(message.sessionId, async () => {
      const messages = new Map(
        (await this.readMessages(message.sessionId)).map((item) => [item.id, item])
      );
      messages.set(message.id, message);
      await this.storage.replace(
        message.sessionId,
        serializeMessages([...messages.values()])
      );
    });
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.enqueue(sessionId, () => this.storage.delete(sessionId));
  }

  private enqueue(sessionId: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.pending.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    const tracked = next.finally(() => {
      if (this.pending.get(sessionId) === tracked) this.pending.delete(sessionId);
    });
    this.pending.set(sessionId, tracked);
    return tracked;
  }
}

function serializeMessages(messages: readonly ConversationMessage[]): string {
  const content = [...messages]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map(serialize)
    .join('\n');
  return content ? `${content}\n` : '';
}

function serialize(message: ConversationMessage): string {
  const entry: ConversationMessageLogEntry = {
    version: 1,
    operation: 'put',
    message
  };
  return JSON.stringify(entry);
}

function parseEntry(line: string): ConversationMessageLogEntry | undefined {
  if (!line.trim()) return undefined;
  try {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const entry = value as Record<string, unknown>;
    if (entry.version !== 1) return undefined;
    if (entry.operation === 'put' && isMessage(entry.message)) {
      return entry as unknown as ConversationMessageLogEntry;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function isMessage(value: unknown): value is ConversationMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Partial<ConversationMessage>;
  return typeof message.id === 'string'
    && typeof message.sessionId === 'string'
    && ['system', 'user', 'assistant', 'tool'].includes(String(message.role))
    && typeof message.content === 'string'
    && typeof message.createdAt === 'number';
}
