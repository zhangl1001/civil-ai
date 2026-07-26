import {
  AI_TASK_CONCURRENCY_OPTIONS,
  type AIConfig,
  type AITaskConcurrency
} from '@/domain/ai';
import { normalizeAnthropicModelName } from '@/capabilities/ai-runtime/public';
import { secureStoreAdapter } from '@/platform/SecureStoreAdapter';

const AI_CONFIG_KEY = 'zhangl-ai-config';
export const AI_CONFIG_CHANGED_EVENT = 'zhangl-ai-config-changed';

const DEFAULT_CONFIG: AIConfig = {
  provider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  streamingEnabled: true,
  maxConcurrentTasks: 3,
  updatedAt: 0
};

export class AIConfigService {
  async load(): Promise<AIConfig> {
    const config = await secureStoreAdapter.get<Partial<AIConfig> & { provider?: string }>(AI_CONFIG_KEY, DEFAULT_CONFIG);
    return normalizeAIConfig(config);
  }

  async save(input: Omit<AIConfig, 'updatedAt'> | AIConfig): Promise<AIConfig> {
    const next = normalizeAIConfig({ ...input, updatedAt: Date.now() });
    await secureStoreAdapter.set(AI_CONFIG_KEY, next);
    window.dispatchEvent(new CustomEvent(AI_CONFIG_CHANGED_EVENT));
    return next;
  }

  async clear(): Promise<void> {
    await secureStoreAdapter.remove(AI_CONFIG_KEY);
    window.dispatchEvent(new CustomEvent(AI_CONFIG_CHANGED_EVENT));
  }

  isNativeSecure(): boolean {
    return secureStoreAdapter.isNative();
  }
}

export const aiConfigService = new AIConfigService();

export function normalizeAIConfig(input: Partial<AIConfig> & { provider?: string }): AIConfig {
  const provider = input.provider === 'anthropic' ? 'anthropic' : 'openai';
  const baseUrl = input.baseUrl ?? DEFAULT_CONFIG.baseUrl ?? '';
  const model = provider === 'anthropic'
    ? normalizeAnthropicModelName(baseUrl, input.model ?? DEFAULT_CONFIG.model)
    : (input.model ?? DEFAULT_CONFIG.model).trim();
  return {
    ...DEFAULT_CONFIG,
    ...input,
    provider,
    baseUrl,
    model,
    maxConcurrentTasks: normalizeTaskConcurrency(input.maxConcurrentTasks),
    updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : 0
  };
}

function normalizeTaskConcurrency(value: unknown): AITaskConcurrency {
  const numeric = typeof value === 'number' ? Math.round(value) : Number.NaN;
  return AI_TASK_CONCURRENCY_OPTIONS.includes(numeric as AITaskConcurrency)
    ? numeric as AITaskConcurrency
    : DEFAULT_CONFIG.maxConcurrentTasks;
}
