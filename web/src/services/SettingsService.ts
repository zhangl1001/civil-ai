import { database } from '@/db/database';
import { STORES } from '@/db/schema';
import type { AppSetting } from '@/domain/project';

export class SettingsService {
  async get<T>(key: string, fallback: T): Promise<T> {
    const record = await database.get<AppSetting>(STORES.settings, key);
    return record ? (record.value as T) : fallback;
  }

  async set(key: string, value: unknown): Promise<void> {
    await database.put<AppSetting>(STORES.settings, {
      key,
      value,
      updatedAt: Date.now()
    });
  }

  async delete(key: string): Promise<void> {
    await database.delete(STORES.settings, key);
  }
}

export const settingsService = new SettingsService();
