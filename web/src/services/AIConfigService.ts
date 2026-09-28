import {
  AI_TASK_CONCURRENCY_OPTIONS,
  type AIConfig,
  type AIProviderType,
  type AITaskConcurrency
} from '@/domain/ai';
import { normalizeAnthropicModelName } from '@/capabilities/ai-runtime/public';
import { secureStoreAdapter } from '@/platform/SecureStoreAdapter';

const AI_CONFIG_KEY = 'zhangl-ai-config';
export const AI_CONFIG_CHANGED_EVENT = 'zhangl-ai-config-changed';

/** What a provider's form starts from, and what an untouched field follows when the protocol changes. */
export const AI_PROVIDER_DEFAULTS: Readonly<Record<AIProviderType, { readonly baseUrl: string; readonly model: string }>> = Object.freeze({
  openai: Object.freeze({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }),
  anthropic: Object.freeze({ baseUrl: 'https://api.anthropic.com/v1', model: 'claude-opus-5' })
});

const DEFAULT_PROVIDER_URLS = new Set([
  ...Object.values(AI_PROVIDER_DEFAULTS).map((item) => comparableUrl(item.baseUrl)),
  'https://api.anthropic.com'
]);
const DEFAULT_PROVIDER_MODELS = new Set(Object.values(AI_PROVIDER_DEFAULTS).map((item) => item.model));

const DEFAULT_CONFIG: AIConfig = {
  provider: 'openai',
  apiKey: '',
  baseUrl: AI_PROVIDER_DEFAULTS.openai.baseUrl,
  model: AI_PROVIDER_DEFAULTS.openai.model,
  streamingEnabled: true,
  maxConcurrentTasks: 3,
  updatedAt: 0
};

export class AIConfigValidationError extends Error {
  readonly code = 'ai_config.invalid';
}

export class AIConfigService {
  async load(): Promise<AIConfig> {
    const config = await secureStoreAdapter.get<Partial<AIConfig> & { provider?: string }>(AI_CONFIG_KEY, DEFAULT_CONFIG);
    return normalizeAIConfig(config);
  }

  /**
   * Refuses a configuration that could never work instead of persisting it:
   * the saved Base URL is also the host the iOS network layer binds the key to,
   * so a malformed value would break every model request, and "测试" saves
   * before it tests.
   */
  async save(input: Omit<AIConfig, 'updatedAt'> | AIConfig): Promise<AIConfig> {
    const provider = input.provider === 'anthropic' ? 'anthropic' : 'openai';
    const invalid = validateAIBaseUrl(provider, input.baseUrl ?? '');
    if (invalid) throw new AIConfigValidationError(invalid);
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
  // An empty Base URL is the provider's own endpoint. Storing it empty would
  // leave the native layer without a host to bind the credential to.
  const baseUrl = input.baseUrl?.trim() || AI_PROVIDER_DEFAULTS[provider].baseUrl;
  const requestedModel = input.model ?? AI_PROVIDER_DEFAULTS[provider].model;
  const model = provider === 'anthropic'
    ? normalizeAnthropicModelName(baseUrl, requestedModel)
    : requestedModel.trim();
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

/**
 * Base URL and model after the protocol changes: a field still holding a
 * provider default (or nothing) follows the new provider, while anything the
 * user typed, such as a compatible gateway or a custom model, is kept.
 */
export function switchAIProvider(
  current: { readonly baseUrl?: string; readonly model: string },
  next: AIProviderType
): { baseUrl: string; model: string } {
  const baseUrl = current.baseUrl?.trim() ?? '';
  const model = current.model.trim();
  return {
    baseUrl: !baseUrl || DEFAULT_PROVIDER_URLS.has(comparableUrl(baseUrl)) ? AI_PROVIDER_DEFAULTS[next].baseUrl : baseUrl,
    model: !model || DEFAULT_PROVIDER_MODELS.has(model) ? AI_PROVIDER_DEFAULTS[next].model : model
  };
}

/** A user-facing reason the Base URL cannot work, or `undefined`; empty means the provider default. */
export function validateAIBaseUrl(provider: AIProviderType, value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  const example = AI_PROVIDER_DEFAULTS[provider].baseUrl;
  if (/\s/.test(raw)) return 'Base URL 不能包含空格或换行';
  if ((raw.match(/:\/\//g)?.length ?? 0) > 1 || /https?:/i.test(raw.slice(raw.indexOf(':') + 1))) {
    return '检测到多个地址拼在一起，请只保留一个 Base URL，例如 https://api.deepseek.com/anthropic';
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `Base URL 格式不正确，请填写完整地址，例如 ${example}`;
  }
  if (url.protocol !== 'https:') return 'Base URL 必须以 https:// 开头';
  if (url.username || url.password) return 'Base URL 不能包含用户名或密码，密钥请填写在 API Key 中';
  if (!url.hostname.includes('.')) return `Base URL 的域名不完整，例如 ${example}`;
  if (url.port) return 'Base URL 只支持标准 HTTPS 端口，请去掉端口号';
  if (url.search || url.hash || /[?#]/.test(raw)) return 'Base URL 不能包含 ? 或 # 之后的参数';
  if (provider === 'anthropic' && url.hostname.toLowerCase() === 'api.openai.com') {
    return 'Anthropic 原生协议不能使用 OpenAI 的地址，请改用 https://api.anthropic.com/v1 或服务商提供的 Anthropic 兼容地址';
  }
  return undefined;
}

function comparableUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

function normalizeTaskConcurrency(value: unknown): AITaskConcurrency {
  const numeric = typeof value === 'number' ? Math.round(value) : Number.NaN;
  return AI_TASK_CONCURRENCY_OPTIONS.includes(numeric as AITaskConcurrency)
    ? numeric as AITaskConcurrency
    : DEFAULT_CONFIG.maxConcurrentTasks;
}
