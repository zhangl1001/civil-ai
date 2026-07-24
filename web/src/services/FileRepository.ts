import { database } from '@/db/database';
import { fileId, STORES, type FileRecord } from '@/db/schema';

function contentTypeForPath(path: string): FileRecord['contentType'] {
  if (/\.json$/i.test(path)) return 'json';
  if (/\.md$/i.test(path)) return 'markdown';
  return 'text';
}

export class FileRepository {
  async readText(projectId: string, path: string): Promise<string> {
    const record = await database.get<FileRecord>(STORES.files, fileId(projectId, path));
    return record?.content || '';
  }

  async readJson<T>(projectId: string, path: string, fallback: T): Promise<T> {
    const text = await this.readText(projectId, path);
    if (!text) return fallback;
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  }

  async writeText(projectId: string, path: string, content: string): Promise<FileRecord> {
    const id = fileId(projectId, path);
    const existing = await database.get<FileRecord>(STORES.files, id);
    const now = Date.now();
    const record: FileRecord = {
      id,
      projectId,
      path,
      content,
      contentType: contentTypeForPath(path),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    await database.put<FileRecord>(STORES.files, record);
    return record;
  }

  async list(projectId: string): Promise<FileRecord[]> {
    return database.queryByIndex<FileRecord>(STORES.files, 'projectId', projectId);
  }

  async delete(projectId: string, path: string): Promise<void> {
    await database.delete(STORES.files, fileId(projectId, path));
  }
}

export const fileRepository = new FileRepository();
