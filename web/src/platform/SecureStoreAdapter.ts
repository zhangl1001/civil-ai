import { settingsService } from '@/services/SettingsService';
import { capacitorRuntime, type KeychainPlugin } from './capacitor';

export class SecureStoreAdapter {
  private keychain(): KeychainPlugin | undefined {
    return capacitorRuntime()?.Plugins?.Keychain;
  }

  isNative(): boolean {
    return Boolean(this.keychain());
  }

  async get<T>(key: string, fallback: T): Promise<T> {
    const plugin = this.keychain();
    if (plugin) {
      const result = await plugin.get({ key });
      return this.parse(result.value, fallback);
    }
    return settingsService.get<T>(`secure-fallback:${key}`, fallback);
  }

  async set<T>(key: string, value: T): Promise<void> {
    const serialized = JSON.stringify(value);
    const plugin = this.keychain();
    if (plugin) {
      await plugin.set({ key, value: serialized });
      await settingsService.set(`secure-fallback:${key}`, null);
      return;
    }
    await settingsService.set(`secure-fallback:${key}`, value);
  }

  async remove(key: string): Promise<void> {
    const plugin = this.keychain();
    if (plugin) {
      await plugin.remove({ key });
    }
    await settingsService.set(`secure-fallback:${key}`, null);
  }

  private parse<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
}

export const secureStoreAdapter = new SecureStoreAdapter();
