import { computed, reactive } from 'vue';
import type { AIConfig, AIProviderType } from '@/domain/ai';
import {
  WebSearchFreshness,
  WebSearchProvider,
  type WebSearchProviderCode
} from '@/capabilities/web-research/public';
import { configuredAIClient } from '@/composition-root/public';
import {
  AI_PROVIDER_DEFAULTS,
  aiConfigService,
  switchAIProvider,
  validateAIBaseUrl
} from '@/services/AIConfigService';
import { webResearchConfigService } from '@/services/WebResearchConfigService';
import { webResearchService } from '@/services/WebResearchService';

export const AI_PROVIDER_OPTIONS: ReadonlyArray<{ value: AIProviderType; label: string }> = [
  { value: 'openai', label: 'OpenAI 兼容协议' },
  { value: 'anthropic', label: 'Anthropic 原生协议' }
];

export const WEB_SEARCH_PROVIDER_OPTIONS: ReadonlyArray<{ value: WebSearchProviderCode; label: string }> = [
  { value: WebSearchProvider.Auto, label: '智能自动' },
  { value: WebSearchProvider.Jina, label: 'Jina Search' },
  { value: WebSearchProvider.Brave, label: 'Brave Search' },
  { value: WebSearchProvider.Firecrawl, label: 'Firecrawl' },
  { value: WebSearchProvider.SearXNG, label: 'SearXNG' }
];

const DEFAULT_FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev';

/**
 * AI model and web-research settings as the profile page edits them.
 *
 * The state belongs to whoever calls this (the cached profile page), so input
 * that was typed but not saved survives closing the sheet and switching tabs.
 */
export function useAIModelSettings() {
  const form = reactive<Omit<AIConfig, 'updatedAt'>>({
    provider: 'openai',
    apiKey: '',
    baseUrl: AI_PROVIDER_DEFAULTS.openai.baseUrl,
    model: AI_PROVIDER_DEFAULTS.openai.model,
    streamingEnabled: true,
    maxConcurrentTasks: 3
  });
  const webResearch = reactive({
    enabled: true,
    provider: WebSearchProvider.Auto as WebSearchProviderCode,
    apiKey: '',
    jinaApiKey: '',
    braveApiKey: '',
    firecrawlApiKey: '',
    firecrawlBaseUrl: DEFAULT_FIRECRAWL_BASE_URL,
    searxngBaseUrl: ''
  });
  const status = reactive({ saving: false, testing: false, message: '' });
  const summaryLabel = computed(() => form.apiKey ? `${form.provider} · ${form.model || '未填模型'}` : '未配置');

  async function load(): Promise<void> {
    const [config, webConfig] = await Promise.all([aiConfigService.load(), webResearchConfigService.load()]);
    form.provider = config.provider;
    form.apiKey = config.apiKey;
    form.baseUrl = config.baseUrl || '';
    form.model = config.model;
    form.streamingEnabled = config.streamingEnabled !== false;
    form.maxConcurrentTasks = config.maxConcurrentTasks;
    webResearch.enabled = webConfig.enabled;
    webResearch.provider = webConfig.provider;
    webResearch.apiKey = webConfig.apiKey;
    webResearch.jinaApiKey = webConfig.jinaApiKey || '';
    webResearch.braveApiKey = webConfig.braveApiKey || '';
    webResearch.firecrawlApiKey = webConfig.firecrawlApiKey || '';
    webResearch.firecrawlBaseUrl = webConfig.firecrawlBaseUrl || DEFAULT_FIRECRAWL_BASE_URL;
    webResearch.searxngBaseUrl = webConfig.searxngBaseUrl || '';
  }

  /** Changing protocol carries the new provider's endpoint and model unless the user typed their own. */
  function selectProvider(provider: AIProviderType): void {
    if (provider === form.provider) return;
    Object.assign(form, switchAIProvider(form, provider), { provider });
  }

  /** Validates before anything is written, so a working saved config is never replaced by a broken one. */
  async function persist(): Promise<boolean> {
    const invalid = validateAIBaseUrl(form.provider, form.baseUrl ?? '');
    if (invalid) {
      status.message = invalid;
      return false;
    }
    const [saved] = await Promise.all([
      aiConfigService.save({
        provider: form.provider,
        apiKey: form.apiKey.trim(),
        baseUrl: form.baseUrl?.trim(),
        model: form.model.trim(),
        streamingEnabled: form.streamingEnabled !== false,
        maxConcurrentTasks: form.maxConcurrentTasks
      }),
      webResearchConfigService.save({
        enabled: webResearch.enabled,
        provider: webResearch.provider,
        apiKey: webResearch.apiKey.trim(),
        jinaApiKey: webResearch.jinaApiKey.trim(),
        braveApiKey: webResearch.braveApiKey.trim(),
        firecrawlApiKey: webResearch.firecrawlApiKey.trim(),
        firecrawlBaseUrl: webResearch.firecrawlBaseUrl.trim(),
        searxngBaseUrl: webResearch.searxngBaseUrl.trim()
      })
    ]);
    form.baseUrl = saved.baseUrl;
    return true;
  }

  async function save(): Promise<void> {
    if (status.saving) return;
    status.saving = true;
    status.message = '';
    try {
      if (await persist()) {
        status.message = aiConfigService.isNativeSecure() ? '已保存到 iOS Keychain' : '已保存到本地开发存储';
      }
    } catch (error) {
      status.message = error instanceof Error ? error.message : '保存失败';
    } finally {
      status.saving = false;
    }
  }

  async function test(): Promise<void> {
    if (status.testing) return;
    status.testing = true;
    status.message = '';
    try {
      if (!await persist()) return;
      const result = await configuredAIClient.testConnection();
      await configuredAIClient.testStructuredOutput();
      if (webResearch.enabled) {
        const search = await webResearchService.search({
          query: '中国 公务员考试 时政',
          freshness: WebSearchFreshness.Month,
          limit: 1
        });
        status.message = `模型与网络搜索正常：${result.slice(0, 18)} · ${search.hits.length} 条来源`;
      } else {
        status.message = `连接正常：${result.slice(0, 24)}`;
      }
    } catch (error) {
      status.message = error instanceof Error ? error.message : '连接测试失败';
    } finally {
      status.testing = false;
    }
  }

  async function clear(): Promise<void> {
    await Promise.all([aiConfigService.clear(), webResearchConfigService.clear()]);
    form.apiKey = '';
    webResearch.enabled = true;
    webResearch.provider = WebSearchProvider.Auto;
    webResearch.apiKey = '';
    webResearch.jinaApiKey = '';
    webResearch.braveApiKey = '';
    webResearch.firecrawlApiKey = '';
    webResearch.firecrawlBaseUrl = DEFAULT_FIRECRAWL_BASE_URL;
    webResearch.searxngBaseUrl = '';
    status.message = '已清空 AI 配置';
  }

  return { form, webResearch, status, summaryLabel, load, selectProvider, save, test, clear };
}

export type AIModelSettings = ReturnType<typeof useAIModelSettings>;
