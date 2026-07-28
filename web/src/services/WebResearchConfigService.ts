import {
  WebSearchProvider,
  type WebResearchConfig,
  type WebSearchProviderCode
} from '@/capabilities/web-research/public';
import { secureStoreAdapter } from '@/platform/SecureStoreAdapter';

const WEB_RESEARCH_CONFIG_KEY = 'zhangl-web-research-config';
export const WEB_RESEARCH_CONFIG_CHANGED_EVENT = 'zhangl-web-research-config-changed';

const DEFAULT_CONFIG: WebResearchConfig = {
  enabled: true,
  provider: WebSearchProvider.BuiltIn,
  apiKey: '',
  updatedAt: 0
};

export class WebResearchConfigService {
  async load(): Promise<WebResearchConfig> {
    const stored = await secureStoreAdapter.get<Partial<WebResearchConfig>>(
      WEB_RESEARCH_CONFIG_KEY,
      DEFAULT_CONFIG
    );
    return normalizeWebResearchConfig(stored);
  }

  async save(input: Omit<WebResearchConfig, 'updatedAt'> | WebResearchConfig): Promise<WebResearchConfig> {
    const next = normalizeWebResearchConfig({ ...input, updatedAt: Date.now() });
    await secureStoreAdapter.set(WEB_RESEARCH_CONFIG_KEY, next);
    window.dispatchEvent(new CustomEvent(WEB_RESEARCH_CONFIG_CHANGED_EVENT));
    return next;
  }

  async clear(): Promise<void> {
    await secureStoreAdapter.remove(WEB_RESEARCH_CONFIG_KEY);
    window.dispatchEvent(new CustomEvent(WEB_RESEARCH_CONFIG_CHANGED_EVENT));
  }
}

export const webResearchConfigService = new WebResearchConfigService();

export function normalizeWebResearchConfig(input: Partial<WebResearchConfig>): WebResearchConfig {
  return {
    enabled: input.enabled === true,
    provider: normalizeProvider(input.provider),
    apiKey: typeof input.apiKey === 'string' ? input.apiKey.trim() : '',
    updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : 0
  };
}

function normalizeProvider(value: unknown): WebSearchProviderCode {
  if (value === WebSearchProvider.Brave) return WebSearchProvider.Brave;
  if (value === WebSearchProvider.Jina) return WebSearchProvider.Jina;
  return WebSearchProvider.BuiltIn;
}
