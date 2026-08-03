import type { HttpTransport } from '@/capabilities/ai-runtime/public';
import type { WebResearchConfig } from '../domain/WebResearchConfig';
import { WebSearchProvider } from '../domain/WebResearchConfig';
import { requirePublicWebUrl } from '../domain/WebUrlPolicy';
import type {
  WebPageResponse,
  WebPageReadOptions,
  WebResearchGateway,
  WebSearchRequest,
  WebSearchResponse
} from '../contracts/WebResearchGateway';
import type {
  RankedProviderResults,
  WebPageProviderAdapter,
  WebSearchProviderAdapter
} from '../contracts/WebResearchProvider';
import {
  compactWebFailures,
  runBoundedWebResearchAttempt
} from './WebResearchHttp';
import { rankWebSearchResults } from './WebResearchRanking';
import {
  FirecrawlPageProviderAdapter,
  isInsufficientWebDocument,
  JinaReaderProviderAdapter,
  NativeReadabilityProviderAdapter
} from './providers/PageProviderAdapters';
import {
  BraveSearchProviderAdapter,
  BuiltInSearchProviderAdapter,
  FirecrawlSearchProviderAdapter,
  JinaSearchProviderAdapter,
  SearXNGSearchProviderAdapter
} from './providers/SearchProviderAdapters';

const SEARCH_PROVIDER_TIMEOUT_MS = 10_000;
const PAGE_PROVIDER_TIMEOUT_MS = 12_000;

export class ConfiguredWebResearchGateway implements WebResearchGateway {
  private readonly searchProviders: readonly WebSearchProviderAdapter[];
  private readonly pageProviders: readonly WebPageProviderAdapter[];

  constructor(
    private readonly config: WebResearchConfig,
    transport: HttpTransport
  ) {
    this.searchProviders = createSearchProviders(config, transport);
    this.pageProviders = createPageProviders(config, transport);
  }

  async search(request: WebSearchRequest): Promise<WebSearchResponse> {
    const providers = this.searchProviders.filter((provider) => provider.configured);
    if (!providers.length) throw new Error('没有可用的网络搜索 Provider。');
    if (this.config.provider !== WebSearchProvider.Auto) {
      const failures: unknown[] = [];
      for (const provider of providers) {
        try {
          const providerHits = await runBoundedWebResearchAttempt(
            request.signal,
            SEARCH_PROVIDER_TIMEOUT_MS,
            (signal) => provider.search({ ...request, signal })
          );
          const ranked = rankWebSearchResults(
            request.query,
            [{ provider: provider.id, hits: providerHits }],
            request.limit,
            provider.id === 'built-in'
          );
          if (ranked.length) return { query: request.query, hits: ranked, fetchedAt: Date.now() };
        } catch (error) {
          request.signal?.throwIfAborted();
          failures.push(error);
        }
      }
      throw new Error(`联网搜索暂时不可用：${compactWebFailures(...failures)}`);
    }
    const settled = await Promise.allSettled(providers.map((provider) => (
      runBoundedWebResearchAttempt(
        request.signal,
        SEARCH_PROVIDER_TIMEOUT_MS,
        (signal) => provider.search({ ...request, signal })
      ).then((hits): RankedProviderResults => ({ provider: provider.id, hits }))
    )));
    request.signal?.throwIfAborted();
    const groups = settled.flatMap((result) => result.status === 'fulfilled' && result.value.hits.length
      ? [result.value]
      : []);
    const hits = rankWebSearchResults(request.query, groups, request.limit);
    if (!hits.length) {
      const failures = settled.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
      throw new Error(`联网搜索暂时不可用：${compactWebFailures(...failures)}`);
    }
    return { query: request.query, hits, fetchedAt: Date.now() };
  }

  async readPage(value: string, signal?: AbortSignal, options?: WebPageReadOptions): Promise<WebPageResponse> {
    const target = requirePublicWebUrl(value);
    const failures: unknown[] = [];
    let bestPartial: WebPageResponse | undefined;
    for (const provider of this.pageProviders) {
      if (!provider.configured) continue;
      signal?.throwIfAborted();
      try {
        const page = await runBoundedWebResearchAttempt(
          signal,
          PAGE_PROVIDER_TIMEOUT_MS,
          (boundedSignal) => provider.read(target, boundedSignal, options)
        );
        if (!isInsufficientWebDocument(page) || target.pathname.toLowerCase().endsWith('.pdf')) return page;
        if (!bestPartial || page.content.length > bestPartial.content.length) bestPartial = page;
      } catch (error) {
        signal?.throwIfAborted();
        failures.push(error);
      }
    }
    if (bestPartial) return bestPartial;
    throw new Error(`网页读取暂时不可用：${compactWebFailures(...failures)}`);
  }
}

export { runBoundedWebResearchAttempt } from './WebResearchHttp';

function createSearchProviders(
  config: WebResearchConfig,
  transport: HttpTransport
): readonly WebSearchProviderAdapter[] {
  const jinaKey = config.jinaApiKey || (config.provider === WebSearchProvider.Jina ? config.apiKey : '');
  const braveKey = config.braveApiKey || (config.provider === WebSearchProvider.Brave ? config.apiKey : '');
  const firecrawlKey = config.firecrawlApiKey || (config.provider === WebSearchProvider.Firecrawl ? config.apiKey : '');
  const all: Record<string, WebSearchProviderAdapter> = {
    [WebSearchProvider.Jina]: new JinaSearchProviderAdapter(transport, jinaKey),
    [WebSearchProvider.Brave]: new BraveSearchProviderAdapter(transport, braveKey),
    [WebSearchProvider.Firecrawl]: new FirecrawlSearchProviderAdapter(
      transport,
      firecrawlKey,
      config.firecrawlBaseUrl || 'https://api.firecrawl.dev'
    ),
    [WebSearchProvider.SearXNG]: new SearXNGSearchProviderAdapter(transport, config.searxngBaseUrl || ''),
    [WebSearchProvider.BuiltIn]: new BuiltInSearchProviderAdapter(transport)
  };
  if (config.provider !== WebSearchProvider.Auto) {
    const preferred = all[config.provider];
    const fallback = all[WebSearchProvider.BuiltIn];
    return preferred && preferred.id !== fallback.id ? [preferred, fallback] : [fallback];
  }
  return [
    all[WebSearchProvider.Jina],
    all[WebSearchProvider.Brave],
    all[WebSearchProvider.Firecrawl],
    all[WebSearchProvider.SearXNG],
    all[WebSearchProvider.BuiltIn]
  ];
}

function createPageProviders(
  config: WebResearchConfig,
  transport: HttpTransport
): readonly WebPageProviderAdapter[] {
  const jinaKey = config.jinaApiKey || (config.provider === WebSearchProvider.Jina ? config.apiKey : '');
  const firecrawlKey = config.firecrawlApiKey || (config.provider === WebSearchProvider.Firecrawl ? config.apiKey : '');
  return [
    new JinaReaderProviderAdapter(transport, jinaKey),
    new FirecrawlPageProviderAdapter(
      transport,
      firecrawlKey,
      config.firecrawlBaseUrl || 'https://api.firecrawl.dev'
    ),
    new NativeReadabilityProviderAdapter(transport)
  ];
}
