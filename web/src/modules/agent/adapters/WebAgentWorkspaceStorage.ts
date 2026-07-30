import type { AgentWorkspaceStorage } from '../contracts/AgentWorkspaceStorage';

interface OpfsDirectory {
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<OpfsDirectory>;
  getFileHandle(name: string, options: { create: boolean }): Promise<OpfsFileHandle>;
  removeEntry(name: string): Promise<void>;
  values(): AsyncIterableIterator<OpfsEntry>;
}

interface OpfsFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(options: { keepExistingData: boolean }): Promise<OpfsWritable>;
}

interface OpfsDirectoryEntry {
  readonly kind: 'directory';
  readonly name: string;
}

type OpfsEntry = OpfsFileHandle | OpfsDirectoryEntry;

interface OpfsWritable {
  seek(position: number): Promise<void>;
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface StorageManagerWithOpfs {
  getDirectory?: () => Promise<OpfsDirectory>;
}

const LOG_DIRECTORY = 'zhangl-agent-workspace';
const LOCAL_PREFIX = 'zhangl-agent-workspace:';

export interface AgentWorkspaceLimits {
  readonly maximumKeyBytes: number;
  readonly maximumLineBytes: number;
  readonly maximumFileBytes: number;
  readonly maximumFileCount: number;
  readonly maximumWorkspaceBytes: number;
}

export const DEFAULT_AGENT_WORKSPACE_LIMITS: AgentWorkspaceLimits = Object.freeze({
  maximumKeyBytes: 256,
  maximumLineBytes: 64 * 1_024,
  maximumFileBytes: 4 * 1_024 * 1_024,
  maximumFileCount: 64,
  maximumWorkspaceBytes: 32 * 1_024 * 1_024
});

export class WebAgentWorkspaceStorage implements AgentWorkspaceStorage {
  private readonly pending = new Map<string, Promise<void>>();
  private mutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly limits: AgentWorkspaceLimits = DEFAULT_AGENT_WORKSPACE_LIMITS
  ) {}

  append(logKey: string, line: string): Promise<void> {
    this.assertKey(logKey);
    const addition = `${line}\n`;
    const additionBytes = byteLength(addition);
    if (byteLength(line) > this.limits.maximumLineBytes) {
      return Promise.reject(new Error('Agent workspace line exceeds the configured limit'));
    }
    return this.enqueue(logKey, async () => {
      const directory = await this.directory();
      if (!directory) {
        const key = localKey(logKey);
        const current = localStorage.getItem(key) || '';
        this.assertMutation(await this.localState(key), byteLength(current) + additionBytes);
        localStorage.setItem(key, `${current}${addition}`);
        return;
      }
      const name = fileName(logKey);
      const state = await this.opfsState(directory, name);
      this.assertMutation(state, state.fileBytes + additionBytes);
      const handle = await directory.getFileHandle(name, { create: true });
      const writable = await handle.createWritable({ keepExistingData: true });
      await writable.seek(state.fileBytes);
      await writable.write(addition);
      await writable.close();
    });
  }

  replace(logKey: string, content: string): Promise<void> {
    this.assertKey(logKey);
    const contentBytes = byteLength(content);
    if (contentBytes > this.limits.maximumFileBytes) {
      return Promise.reject(new Error('Agent workspace replacement exceeds the configured file limit'));
    }
    return this.enqueue(logKey, async () => {
      const directory = await this.directory();
      if (!directory) {
        this.assertMutation(await this.localState(localKey(logKey)), contentBytes);
        if (content) localStorage.setItem(localKey(logKey), content);
        else localStorage.removeItem(localKey(logKey));
        return;
      }
      const name = fileName(logKey);
      const state = await this.opfsState(directory, name);
      this.assertMutation(state, contentBytes);
      if (!content) {
        if (state.fileExists) await directory.removeEntry(name);
        return;
      }
      const handle = await directory.getFileHandle(name, { create: true });
      const writable = await handle.createWritable({ keepExistingData: false });
      await writable.write(content);
      await writable.close();
    });
  }

  async read(logKey: string): Promise<string> {
    this.assertKey(logKey);
    await this.pending.get(logKey);
    const directory = await this.directory();
    if (!directory) {
      const content = localStorage.getItem(localKey(logKey)) || '';
      this.assertReadableBytes(byteLength(content));
      return content;
    }
    try {
      const handle = await directory.getFileHandle(fileName(logKey), { create: false });
      const file = await handle.getFile();
      this.assertReadableBytes(file.size);
      return file.text();
    } catch (error) {
      if (isMissingEntry(error)) return '';
      throw error;
    }
  }

  async delete(logKey: string): Promise<void> {
    this.assertKey(logKey);
    await this.enqueue(logKey, async () => {
      localStorage.removeItem(localKey(logKey));
      const directory = await this.directory();
      if (!directory) return;
      try {
        await directory.removeEntry(fileName(logKey));
      } catch (error) {
        if (!isMissingEntry(error)) throw error;
      }
    });
    this.pending.delete(logKey);
  }

  private enqueue(logKey: string, operation: () => Promise<void>): Promise<void> {
    const next = this.mutation.catch(() => undefined).then(operation);
    this.mutation = next;
    const tracked = next.finally(() => {
      if (this.pending.get(logKey) === tracked) this.pending.delete(logKey);
    });
    this.pending.set(logKey, tracked);
    return tracked;
  }

  private async directory(): Promise<OpfsDirectory | undefined> {
    if (typeof navigator === 'undefined') return undefined;
    const manager = navigator.storage as unknown as StorageManagerWithOpfs | undefined;
    if (!manager?.getDirectory) return undefined;
    const root = await manager.getDirectory();
    return root.getDirectoryHandle(LOG_DIRECTORY, { create: true });
  }

  private assertKey(logKey: string): void {
    if (!logKey || byteLength(logKey) > this.limits.maximumKeyBytes) {
      throw new Error('Agent workspace logKey is empty or exceeds the configured limit');
    }
  }

  private assertReadableBytes(fileBytes: number): void {
    if (fileBytes > this.limits.maximumFileBytes) {
      throw new Error('Agent workspace file exceeds the configured read limit');
    }
  }

  private assertMutation(state: WorkspaceState, nextFileBytes: number): void {
    if (nextFileBytes > this.limits.maximumFileBytes) {
      throw new Error('Agent workspace file exceeds the configured limit');
    }
    if (!state.fileExists && nextFileBytes > 0 && state.fileCount >= this.limits.maximumFileCount) {
      throw new Error('Agent workspace exceeds the configured file-count limit');
    }
    if (
      state.totalBytes - state.fileBytes + nextFileBytes
      > this.limits.maximumWorkspaceBytes
    ) {
      throw new Error('Agent workspace exceeds the configured total-size limit');
    }
  }

  private async opfsState(directory: OpfsDirectory, targetName: string): Promise<WorkspaceState> {
    let fileCount = 0;
    let totalBytes = 0;
    let fileBytes = 0;
    let fileExists = false;
    for await (const entry of directory.values()) {
      if (entry.kind !== 'file') continue;
      const size = (await entry.getFile()).size;
      fileCount += 1;
      totalBytes += size;
      if (entry.name === targetName) {
        fileExists = true;
        fileBytes = size;
      }
    }
    return { fileExists, fileBytes, fileCount, totalBytes };
  }

  private async localState(targetKey: string): Promise<WorkspaceState> {
    let fileCount = 0;
    let totalBytes = 0;
    let fileBytes = 0;
    let fileExists = false;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(LOCAL_PREFIX)) continue;
      const size = byteLength(localStorage.getItem(key) || '');
      fileCount += 1;
      totalBytes += size;
      if (key === targetKey) {
        fileExists = true;
        fileBytes = size;
      }
    }
    return { fileExists, fileBytes, fileCount, totalBytes };
  }
}

interface WorkspaceState {
  readonly fileExists: boolean;
  readonly fileBytes: number;
  readonly fileCount: number;
  readonly totalBytes: number;
}

function fileName(logKey: string): string {
  return `${encodeURIComponent(logKey)}.jsonl`;
}

function localKey(logKey: string): string {
  return `${LOCAL_PREFIX}${logKey}`;
}

function isMissingEntry(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
