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
  provider: WebSearchProvider.Auto,
  apiKey: '',
  jinaApiKey: '',
  braveApiKey: '',
  firecrawlApiKey: '',
  firecrawlBaseUrl: 'https://api.firecrawl.dev',
  searxngBaseUrl: '',
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
    jinaApiKey: clean(input.jinaApiKey),
    braveApiKey: clean(input.braveApiKey),
    firecrawlApiKey: clean(input.firecrawlApiKey),
    firecrawlBaseUrl: clean(input.firecrawlBaseUrl) || 'https://api.firecrawl.dev',
    searxngBaseUrl: clean(input.searxngBaseUrl),
    updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : 0
  };
}

function normalizeProvider(value: unknown): WebSearchProviderCode {
  if (value === WebSearchProvider.Auto) return WebSearchProvider.Auto;
  if (value === WebSearchProvider.Brave) return WebSearchProvider.Brave;
  if (value === WebSearchProvider.Jina) return WebSearchProvider.Jina;
  if (value === WebSearchProvider.Firecrawl) return WebSearchProvider.Firecrawl;
  if (value === WebSearchProvider.SearXNG) return WebSearchProvider.SearXNG;
  // Previous releases persisted built_in. Upgrade it to the orchestrated mode
  // so installed apps gain bounded provider fallback without reinstalling.
  return WebSearchProvider.Auto;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
