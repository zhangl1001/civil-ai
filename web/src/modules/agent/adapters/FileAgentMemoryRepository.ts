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

interface MemoryForgetEntry {
  readonly version: 1;
  readonly operation: 'memory.forget';
  readonly memoryId: string;
}

type MemoryEntry = MemoryPutEntry | MemorySupersedeEntry | MemoryForgetEntry | MemoryForgetSessionEntry;

const MEMORY_LOG_KEY = '__agent_memory__';

export class FileAgentMemoryRepository implements AgentMemoryRepository {
  private statePromise?: Promise<MemoryReplayState>;

  constructor(private readonly storage: AgentWorkspaceStorage) {}

  async recall(query: AgentMemoryQuery): Promise<readonly AgentMemoryRecord[]> {
    return [...(await this.state()).records.values()]
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

  async append(record: AgentMemoryRecord): Promise<void> {
    const entry: MemoryPutEntry = { version: 1, operation: 'memory.put', record };
    await this.write(entry);
  }

  async supersede(memoryId: string, replacementId: string): Promise<void> {
    const entry: MemorySupersedeEntry = {
      version: 1,
      operation: 'memory.supersede',
      memoryId,
      replacementId
    };
    await this.write(entry);
  }

  async forget(memoryId: string): Promise<void> {
    const entry: MemoryForgetEntry = {
      version: 1,
      operation: 'memory.forget',
      memoryId
    };
    await this.write(entry);
  }

  async forgetSession(sessionId: string): Promise<void> {
    const entry: MemoryForgetSessionEntry = {
      version: 1,
      operation: 'memory.forget_session',
      sessionId
    };
    await this.write(entry);
  }

  private async state(): Promise<MemoryReplayState> {
    this.statePromise ??= this.replay();
    return this.statePromise;
  }

  private async write(entry: MemoryEntry): Promise<void> {
    await this.storage.append(MEMORY_LOG_KEY, JSON.stringify(entry));
    applyEntry(await this.state(), entry);
  }

  private async replay(): Promise<MemoryReplayState> {
    const state: MemoryReplayState = {
      records: new Map(),
      superseded: new Map(),
      forgottenMemoryIds: new Set(),
      forgottenSessions: new Set()
    };
    (await this.storage.read(MEMORY_LOG_KEY)).split('\n').forEach((line) => {
      const entry = parseEntry(line);
      if (entry) applyEntry(state, entry);
    });
    return state;
  }
}

interface MemoryReplayState {
  readonly records: Map<string, AgentMemoryRecord>;
  readonly superseded: Map<string, string>;
  readonly forgottenMemoryIds: Set<string>;
  readonly forgottenSessions: Set<string>;
}

function applyEntry(state: MemoryReplayState, entry: MemoryEntry): void {
  if (entry.operation === 'memory.forget_session') {
    state.forgottenSessions.add(entry.sessionId);
    state.records.forEach((record, id) => {
      if (record.sessionId === entry.sessionId) state.records.delete(id);
    });
    return;
  }
  if (entry.operation === 'memory.forget') {
    state.forgottenMemoryIds.add(entry.memoryId);
    state.records.delete(entry.memoryId);
    return;
  }
  if (entry.operation === 'memory.supersede') {
    state.superseded.set(entry.memoryId, entry.replacementId);
    const current = state.records.get(entry.memoryId);
    if (current) state.records.set(entry.memoryId, { ...current, supersededBy: entry.replacementId });
    return;
  }
  if (
    state.forgottenMemoryIds.has(entry.record.id)
    || (entry.record.sessionId && state.forgottenSessions.has(entry.record.sessionId))
  ) return;
  const replacementId = state.superseded.get(entry.record.id);
  state.records.set(entry.record.id, replacementId
    ? { ...entry.record, supersededBy: replacementId }
    : entry.record);
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
    if (entry.operation === 'memory.forget' && typeof entry.memoryId === 'string') {
      return entry as unknown as MemoryForgetEntry;
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
