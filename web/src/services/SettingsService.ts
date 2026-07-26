const SETTINGS_PREFIX = 'zhangl-setting:';

export class SettingsService {
  async get<T>(key: string, fallback: T): Promise<T> {
    if (typeof localStorage === 'undefined') return fallback;
    const value = localStorage.getItem(`${SETTINGS_PREFIX}${key}`);
    if (value === null) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    if (value === null || value === undefined) {
      localStorage.removeItem(`${SETTINGS_PREFIX}${key}`);
      return;
    }
    localStorage.setItem(`${SETTINGS_PREFIX}${key}`, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(`${SETTINGS_PREFIX}${key}`);
  }
}

export const settingsService = new SettingsService();
