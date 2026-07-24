import type { AIConfig } from '@/domain/ai';
import { secureStoreAdapter } from '@/platform/SecureStoreAdapter';

const AI_CONFIG_KEY = 'zhangl-ai-config';

const DEFAULT_CONFIG: AIConfig = {
  provider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  streamingEnabled: true,
  updatedAt: 0
};

export class AIConfigService {
  async load(): Promise<AIConfig> {
    const config = await secureStoreAdapter.get<AIConfig>(AI_CONFIG_KEY, DEFAULT_CONFIG);
    if (!config.apiKey && typeof localStorage !== 'undefined') {
      const legacy = this.readLegacyLocalStorage();
      if (legacy.apiKey) {
        await this.save(legacy);
        localStorage.removeItem(AI_CONFIG_KEY);
        return legacy;
      }
    }
    return { ...DEFAULT_CONFIG, ...config };
  }

  async save(input: Omit<AIConfig, 'updatedAt'> | AIConfig): Promise<AIConfig> {
    const next: AIConfig = {
      ...DEFAULT_CONFIG,
      ...input,
      updatedAt: Date.now()
    };
    await secureStoreAdapter.set(AI_CONFIG_KEY, next);
    return next;
  }

  async clear(): Promise<void> {
    await secureStoreAdapter.remove(AI_CONFIG_KEY);
    localStorage.removeItem(AI_CONFIG_KEY);
  }

  isNativeSecure(): boolean {
    return secureStoreAdapter.isNative();
  }

  private readLegacyLocalStorage(): AIConfig {
    try {
      const raw = localStorage.getItem(AI_CONFIG_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        ...DEFAULT_CONFIG,
        provider: parsed.provider || DEFAULT_CONFIG.provider,
        apiKey: parsed.apiKey || parsed.key || '',
        baseUrl: parsed.baseUrl || parsed.base_url || DEFAULT_CONFIG.baseUrl,
        model: parsed.model || DEFAULT_CONFIG.model,
        streamingEnabled: parsed.streamingEnabled !== false,
        updatedAt: Date.now()
      };
    } catch {
      return DEFAULT_CONFIG;
    }
  }
}

export const aiConfigService = new AIConfigService();
