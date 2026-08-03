import type { HttpTransport } from '@/capabilities/ai-runtime/public';
import type { WebSearchHit, WebSearchRequest } from '../../contracts/WebResearchGateway';
import type { WebSearchProviderAdapter } from '../../contracts/WebResearchProvider';
import {
  parseBingHtmlHits,
  parseBraveHits,
  parseDuckDuckGoHits,
  parseFirecrawlHits,
  parseJinaHits,
  parseRssHits,
  parseSearXNGHits,
  parseSogouHtmlHits
} from '../WebSearchResultParsing';
import {
  requireWebResponse,
  runBoundedWebResearchAttempt,
  webResearchProxyOrigin
} from '../WebResearchHttp';

const BUILT_IN_SOURCE_TIMEOUT_MS = 6_000;

export class JinaSearchProviderAdapter implements WebSearchProviderAdapter {
  readonly id = 'jina';
  readonly configured: boolean;

  constructor(
    private readonly transport: HttpTransport,
    private readonly apiKey = ''
  ) {
    this.configured = Boolean(apiKey);
  }

  async search(request: WebSearchRequest): Promise<readonly WebSearchHit[]> {
    const url = new URL(`https://s.jina.ai/${encodeURIComponent(request.query)}`);
    url.searchParams.set('count', String(request.limit));
    const response = await this.transport.send({
      url: url.toString(),
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        'X-Respond-With': 'markdown'
      },
      signal: request.signal
    });
    return parseJinaHits(await requireWebResponse(response, 'Jina 搜索')).slice(0, request.limit);
  }
}

export class BraveSearchProviderAdapter implements WebSearchProviderAdapter {
  readonly id = 'brave';
  readonly configured: boolean;

  constructor(
    private readonly transport: HttpTransport,
    private readonly apiKey: string
  ) {
    this.configured = Boolean(apiKey);
  }

  async search(request: WebSearchRequest): Promise<readonly WebSearchHit[]> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', request.query);
    url.searchParams.set('count', String(request.limit));
    url.searchParams.set('country', 'CN');
    url.searchParams.set('search_lang', 'zh-hans');
    url.searchParams.set('ui_lang', 'zh-CN');
    url.searchParams.set('safesearch', 'strict');
    url.searchParams.set('extra_snippets', 'true');
    const freshness = ({ day: 'pd', week: 'pw', month: 'pm', year: 'py' } as Record<string, string>)[request.freshness];
    if (freshness) url.searchParams.set('freshness', freshness);
    const response = await this.transport.send({
      url: url.toString(),
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': this.apiKey
      },
      signal: request.signal
    });
    return parseBraveHits(await requireWebResponse(response, 'Brave 搜索')).slice(0, request.limit);
  }
}

export class FirecrawlSearchProviderAdapter implements WebSearchProviderAdapter {
  readonly id = 'firecrawl';
  readonly configured: boolean;

  constructor(
    private readonly transport: HttpTransport,
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.firecrawl.dev'
  ) {
    this.configured = Boolean(apiKey);
  }

  async search(request: WebSearchRequest): Promise<readonly WebSearchHit[]> {
    const url = new URL('/v2/search', normalizeBaseUrl(this.baseUrl));
    const response = await this.transport.send({
      url: url.toString(),
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: request.query,
        limit: request.limit,
        sources: ['web'],
        country: 'CN',
        timeout: 8_000,
        ignoreInvalidURLs: true,
        ...(firecrawlFreshness(request.freshness) ? { tbs: firecrawlFreshness(request.freshness) } : {})
      }),
      signal: request.signal
    });
    return parseFirecrawlHits(await requireWebResponse(response, 'Firecrawl 搜索')).slice(0, request.limit);
  }
}

export class SearXNGSearchProviderAdapter implements WebSearchProviderAdapter {
  readonly id = 'searxng';
  readonly configured: boolean;

  constructor(
    private readonly transport: HttpTransport,
    private readonly baseUrl: string
  ) {
    this.configured = Boolean(baseUrl);
  }

  async search(request: WebSearchRequest): Promise<readonly WebSearchHit[]> {
    const url = new URL('/search', normalizeBaseUrl(this.baseUrl));
    url.searchParams.set('q', request.query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('language', 'zh-CN');
    url.searchParams.set('safesearch', '1');
    const freshness = request.freshness === 'any' ? '' : request.freshness;
    if (freshness) url.searchParams.set('time_range', freshness);
    const response = await this.transport.send({
      url: url.toString(),
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: request.signal
    });
    return parseSearXNGHits(await requireWebResponse(response, 'SearXNG 搜索')).slice(0, request.limit);
  }
}

export class BuiltInSearchProviderAdapter implements WebSearchProviderAdapter {
  readonly id = 'built-in';
  readonly configured = true;

  constructor(private readonly transport: HttpTransport) {}

  async search(request: WebSearchRequest): Promise<readonly WebSearchHit[]> {
    const bounded = (operation: (input: WebSearchRequest) => Promise<WebSearchHit[]>) => (
      runBoundedWebResearchAttempt(
        request.signal,
        BUILT_IN_SOURCE_TIMEOUT_MS,
        (signal) => operation({ ...request, signal })
      )
    );
    const results = await Promise.allSettled([
      bounded((input) => this.searchBingRss(input)),
      bounded((input) => this.searchBingHtml(input)),
      bounded((input) => this.searchDuckDuckGo(input)),
      bounded((input) => this.searchSogou(input))
    ]);
    request.signal?.throwIfAborted();
    const hits = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    if (!hits.length) {
      const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
      throw new Error(failures.map((value) => value instanceof Error ? value.message : '').filter(Boolean).join('；'));
    }
    return hits;
  }

  private async searchBingRss(request: WebSearchRequest): Promise<WebSearchHit[]> {
    const url = searchUrl('bing-rss');
    url.searchParams.set('q', request.query);
    url.searchParams.set('format', 'rss');
    url.searchParams.set('setlang', 'zh-cn');
    const freshness = ({ day: 'ex1:"ez1"', week: 'ex1:"ez2"', month: 'ex1:"ez3"', year: 'ex1:"ez5"' } as Record<string, string>)[request.freshness];
    if (freshness) url.searchParams.set('filters', freshness);
    const response = await this.transport.send({
      url: url.toString(),
      method: 'GET',
      headers: publicSearchHeaders('application/rss+xml,application/xml,text/xml;q=0.9'),
      signal: request.signal
    });
    return parseRssHits(await requireWebResponse(response, 'Bing RSS 搜索')).slice(0, request.limit);
  }

  private async searchBingHtml(request: WebSearchRequest): Promise<WebSearchHit[]> {
    const url = searchUrl('bing-html');
    url.searchParams.set('q', request.query);
    url.searchParams.set('setlang', 'zh-cn');
    url.searchParams.set('count', String(Math.max(request.limit, 10)));
    const response = await this.transport.send({
      url: url.toString(),
      method: 'GET',
      headers: publicSearchHeaders('text/html,application/xhtml+xml'),
      signal: request.signal
    });
    return parseBingHtmlHits(await requireWebResponse(response, 'Bing HTML 搜索')).slice(0, request.limit);
  }

  private async searchDuckDuckGo(request: WebSearchRequest): Promise<WebSearchHit[]> {
    let firstError: unknown;
    for (const variant of ['duckduckgo', 'duckduckgo-lite'] as const) {
      request.signal?.throwIfAborted();
      try {
        const url = searchUrl(variant);
        url.searchParams.set('q', request.query);
        url.searchParams.set('kl', 'cn-zh');
        const freshness = ({ day: 'd', week: 'w', month: 'm', year: 'y' } as Record<string, string>)[request.freshness];
        if (freshness) url.searchParams.set('df', freshness);
        const response = await this.transport.send({
          url: url.toString(),
          method: 'GET',
          headers: publicSearchHeaders('text/html,application/xhtml+xml'),
          signal: request.signal
        });
        const hits = parseDuckDuckGoHits(await requireWebResponse(response, 'DuckDuckGo 搜索'));
        if (hits.length) return hits.slice(0, request.limit);
      } catch (error) {
        firstError ||= error;
      }
    }
    throw firstError || new Error('DuckDuckGo 没有返回可解析结果。');
  }

  private async searchSogou(request: WebSearchRequest): Promise<WebSearchHit[]> {
    const url = searchUrl('sogou');
    url.searchParams.set('query', request.query);
    url.searchParams.set('ie', 'utf8');
    const response = await this.transport.send({
      url: url.toString(),
      method: 'GET',
      headers: publicSearchHeaders('text/html,application/xhtml+xml'),
      signal: request.signal
    });
    return parseSogouHtmlHits(await requireWebResponse(response, '搜狗 HTML 搜索')).slice(0, request.limit);
  }
}

function searchUrl(engine: 'bing-rss' | 'bing-html' | 'duckduckgo' | 'duckduckgo-lite' | 'sogou'): URL {
  const proxy = webResearchProxyOrigin();
  if (proxy) {
    const url = new URL(`${proxy}/__web-research/search`);
    if (engine !== 'bing-rss') url.searchParams.set('engine', engine);
    return url;
  }
  if (engine === 'bing-rss' || engine === 'bing-html') return new URL('https://www.bing.com/search');
  if (engine === 'duckduckgo') return new URL('https://html.duckduckgo.com/html/');
  if (engine === 'duckduckgo-lite') return new URL('https://lite.duckduckgo.com/lite/');
  return new URL('https://www.sogou.com/web');
}

function publicSearchHeaders(accept: string): Record<string, string> {
  return {
    Accept: accept,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6'
  };
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function firecrawlFreshness(value: WebSearchRequest['freshness']): string | undefined {
  return ({ day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' } as Record<string, string>)[value];
}
