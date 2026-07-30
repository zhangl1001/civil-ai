import type { AgentWorkspaceStorage } from '../contracts/AgentWorkspaceStorage';

interface OpfsDirectory {
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<OpfsDirectory>;
  getFileHandle(name: string, options: { create: boolean }): Promise<OpfsFileHandle>;
  removeEntry(name: string): Promise<void>;
}

interface OpfsFileHandle {
  getFile(): Promise<File>;
  createWritable(options: { keepExistingData: boolean }): Promise<OpfsWritable>;
}

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

export class WebAgentWorkspaceStorage implements AgentWorkspaceStorage {
  private readonly pending = new Map<string, Promise<void>>();

  append(logKey: string, line: string): Promise<void> {
    return this.enqueue(logKey, async () => {
      const directory = await this.directory();
      if (!directory) {
        const key = localKey(logKey);
        localStorage.setItem(key, `${localStorage.getItem(key) || ''}${line}\n`);
        return;
      }
      const handle = await directory.getFileHandle(fileName(logKey), { create: true });
      const file = await handle.getFile();
      const writable = await handle.createWritable({ keepExistingData: true });
      await writable.seek(file.size);
      await writable.write(`${line}\n`);
      await writable.close();
    });
  }

  replace(logKey: string, content: string): Promise<void> {
    return this.enqueue(logKey, async () => {
      const directory = await this.directory();
      if (!directory) {
        if (content) localStorage.setItem(localKey(logKey), content);
        else localStorage.removeItem(localKey(logKey));
        return;
      }
      const handle = await directory.getFileHandle(fileName(logKey), { create: true });
      const writable = await handle.createWritable({ keepExistingData: false });
      await writable.write(content);
      await writable.close();
    });
  }

  async read(logKey: string): Promise<string> {
    await this.pending.get(logKey);
    const directory = await this.directory();
    if (!directory) return localStorage.getItem(localKey(logKey)) || '';
    try {
      const handle = await directory.getFileHandle(fileName(logKey), { create: false });
      return (await handle.getFile()).text();
    } catch (error) {
      if (isMissingEntry(error)) return '';
      throw error;
    }
  }

  async delete(logKey: string): Promise<void> {
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
    const previous = this.pending.get(logKey) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    const tracked = next.finally(() => {
      if (this.pending.get(logKey) === tracked) this.pending.delete(logKey);
    });
    this.pending.set(logKey, tracked);
    return tracked;
  }

  private async directory(): Promise<OpfsDirectory | undefined> {
    const manager = navigator.storage as unknown as StorageManagerWithOpfs | undefined;
    if (!manager?.getDirectory) return undefined;
    const root = await manager.getDirectory();
    return root.getDirectoryHandle(LOG_DIRECTORY, { create: true });
  }
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
