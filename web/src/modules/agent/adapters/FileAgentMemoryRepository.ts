import type {
  AgentMemoryQuery,
  AgentMemoryRecord,
  AgentMemoryRepository
} from '../contracts/AgentRuntimePorts';
import type { AgentWorkspaceStorage } from '../contracts/AgentWorkspaceStorage';

interface MemoryPutEntry {
  readonly version: 1;
  readonly operation: 'memory.put';
  readonly record: AgentMemoryRecord;
}

interface MemorySupersedeEntry {
  readonly version: 1;
  readonly operation: 'memory.supersede';
  readonly memoryId: string;
  readonly replacementId: string;
}

interface MemoryForgetSessionEntry {
  readonly version: 1;
  readonly operation: 'memory.forget_session';
  readonly sessionId: string;
}

type MemoryEntry = MemoryPutEntry | MemorySupersedeEntry | MemoryForgetSessionEntry;

const MEMORY_LOG_KEY = '__agent_memory__';

export class FileAgentMemoryRepository implements AgentMemoryRepository {
  constructor(private readonly storage: AgentWorkspaceStorage) {}

  async recall(query: AgentMemoryQuery): Promise<readonly AgentMemoryRecord[]> {
    return [...(await this.replay()).values()]
      .filter((record) => !record.supersededBy)
      .filter((record) => record.expiresAt === undefined || record.expiresAt > query.now)
      .filter((record) => matchesScope(record.examCycleId, query.examCycleId))
      .filter((record) => matchesScope(record.sessionId, query.sessionId))
      .filter((record) => matchesScope(record.learningThreadId, query.learningThreadId))
      .filter((record) => query.layers.includes(record.layer))
      .filter((record) => !query.memoryCodes?.length || query.memoryCodes.includes(record.memoryCode))
      .sort((left, right) => right.validFrom - left.validFrom || right.id.localeCompare(left.id))
      .slice(0, query.limit);
  }

  append(record: AgentMemoryRecord): Promise<void> {
    const entry: MemoryPutEntry = { version: 1, operation: 'memory.put', record };
    return this.storage.append(MEMORY_LOG_KEY, JSON.stringify(entry));
  }

  supersede(memoryId: string, replacementId: string): Promise<void> {
    const entry: MemorySupersedeEntry = {
      version: 1,
      operation: 'memory.supersede',
      memoryId,
      replacementId
    };
    return this.storage.append(MEMORY_LOG_KEY, JSON.stringify(entry));
  }

  forgetSession(sessionId: string): Promise<void> {
    const entry: MemoryForgetSessionEntry = {
      version: 1,
      operation: 'memory.forget_session',
      sessionId
    };
    return this.storage.append(MEMORY_LOG_KEY, JSON.stringify(entry));
  }

  private async replay(): Promise<Map<string, AgentMemoryRecord>> {
    const records = new Map<string, AgentMemoryRecord>();
    const superseded = new Map<string, string>();
    const forgottenSessions = new Set<string>();
    (await this.storage.read(MEMORY_LOG_KEY)).split('\n').forEach((line) => {
      const entry = parseEntry(line);
      if (!entry) return;
      if (entry.operation === 'memory.forget_session') {
        forgottenSessions.add(entry.sessionId);
        records.forEach((record, id) => {
          if (record.sessionId === entry.sessionId) records.delete(id);
        });
        return;
      }
      if (entry.operation === 'memory.supersede') {
        superseded.set(entry.memoryId, entry.replacementId);
        const current = records.get(entry.memoryId);
        if (current) records.set(entry.memoryId, { ...current, supersededBy: entry.replacementId });
        return;
      }
      if (entry.record.sessionId && forgottenSessions.has(entry.record.sessionId)) return;
      const replacementId = superseded.get(entry.record.id);
      records.set(entry.record.id, replacementId
        ? { ...entry.record, supersededBy: replacementId }
        : entry.record);
    });
    return records;
  }
}

function parseEntry(line: string): MemoryEntry | undefined {
  if (!line.trim()) return undefined;
  try {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const entry = value as Record<string, unknown>;
    if (entry.version !== 1) return undefined;
    if (entry.operation === 'memory.forget_session' && typeof entry.sessionId === 'string') {
      return entry as unknown as MemoryForgetSessionEntry;
    }
    if (
      entry.operation === 'memory.supersede'
      && typeof entry.memoryId === 'string'
      && typeof entry.replacementId === 'string'
    ) {
      return entry as unknown as MemorySupersedeEntry;
    }
    if (entry.operation === 'memory.put' && isMemoryRecord(entry.record)) {
      return entry as unknown as MemoryPutEntry;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function matchesScope(recordScope: string | undefined, requestedScope: string | undefined): boolean {
  return recordScope === undefined || recordScope === requestedScope;
}

function isMemoryRecord(value: unknown): value is AgentMemoryRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<AgentMemoryRecord>;
  return typeof record.id === 'string'
    && typeof record.layer === 'string'
    && typeof record.memoryCode === 'string'
    && Boolean(record.content)
    && typeof record.content === 'object'
    && !Array.isArray(record.content)
    && typeof record.validFrom === 'number';
}
