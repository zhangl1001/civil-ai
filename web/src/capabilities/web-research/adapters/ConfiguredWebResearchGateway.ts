import type { HttpTransport } from '@/capabilities/ai-runtime/public';
import type { WebResearchConfig } from '../domain/WebResearchConfig';
import { WebSearchProvider } from '../domain/WebResearchConfig';
import { requirePublicWebUrl } from '../domain/WebUrlPolicy';
import type {
  WebPageResponse,
  WebPageReadOptions,
  WebResearchGateway,
  WebSearchHit,
  WebSearchRequest,
  WebSearchResponse
} from '../contracts/WebResearchGateway';
import {
  mergeSearchHits,
  parseBingHtmlHits,
  parseBraveHits,
  parseDuckDuckGoHits,
  parseJinaHits,
  parseRssHits,
  parseSogouHtmlHits,
  relevantSearchHits
} from './WebSearchResultParsing';

const MAX_PAGE_CHARS = 24_000;
const MAX_PAGE_SOURCE_CHARS = 160_000;

export class ConfiguredWebResearchGateway implements WebResearchGateway {
  constructor(
    private readonly config: WebResearchConfig,
    private readonly transport: HttpTransport
  ) {}

  async search(request: WebSearchRequest): Promise<WebSearchResponse> {
    if (this.config.provider === WebSearchProvider.Brave) return this.searchBrave(request);
    if (this.config.provider === WebSearchProvider.Jina) return this.searchJina(request);
    return this.searchBuiltIn(request);
  }

  private async searchBuiltIn(request: WebSearchRequest): Promise<WebSearchResponse> {
    // These public discovery paths fail independently in mobile networks.
    // Merge all usable results so an RSS/index outage does not stop the Agent.
    const [rss, bingHtml, duckDuckGo, sogouHtml] = await Promise.allSettled([
      this.searchBingRss(request),
      this.searchBingHtml(request),
      this.searchDuckDuckGo(request),
      this.searchSogouHtml(request)
    ]);
    request.signal?.throwIfAborted();
    const merged = mergeSearchHits(
      rss.status === 'fulfilled' ? rss.value : [],
      bingHtml.status === 'fulfilled' ? bingHtml.value : [],
      duckDuckGo.status === 'fulfilled' ? duckDuckGo.value : [],
      sogouHtml.status === 'fulfilled' ? sogouHtml.value : []
    );
    const relevant = relevantSearchHits(request.query, merged);
    if (relevant.length) {
      return { query: request.query, hits: relevant.slice(0, request.limit), fetchedAt: Date.now() };
    }
    const rssError = rss.status === 'rejected'
      ? rss.reason
      : new Error('内置 RSS 搜索返回了与关键词不相关的结果。');
    const bingHtmlError = bingHtml.status === 'rejected'
      ? bingHtml.reason
      : new Error('Bing HTML 搜索没有返回相关结果。');
    const duckError = duckDuckGo.status === 'rejected'
      ? duckDuckGo.reason
      : new Error('DuckDuckGo HTML 搜索没有返回相关结果。');
    const sogouError = sogouHtml.status === 'rejected'
      ? sogouHtml.reason
      : new Error('搜狗 HTML 搜索没有返回相关结果。');
    throw new Error(`联网搜索暂时不可用：${compactSearchFailure(rssError, bingHtmlError, duckError, sogouError)}`);
  }

  private async searchBingRss(request: WebSearchRequest): Promise<WebSearchHit[]> {
    const origin = devProxyOrigin();
    const url = new URL(origin
      ? `${origin}/__web-research/search`
      : 'https://www.bing.com/search');
    url.searchParams.set('q', request.query);
    url.searchParams.set('format', 'rss');
    url.searchParams.set('setlang', 'zh-cn');
    const freshness = builtInFreshness(request.freshness);
    if (freshness) url.searchParams.set('filters', freshness);
    const response = await this.transport.send({
      url: url.toString(),
      method: 'GET',
      headers: {
        Accept: 'application/rss+xml,application/xml,text/xml;q=0.9',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6'
      },
      signal: request.signal
    });
    return parseRssHits(await requireOk(response, '内置网络搜索')).slice(0, request.limit);
  }

  private async searchBingHtml(request: WebSearchRequest): Promise<WebSearchHit[]> {
    const origin = devProxyOrigin();
    const url = new URL(origin
      ? `${origin}/__web-research/search`
      : 'https://www.bing.com/search');
    if (origin) url.searchParams.set('engine', 'bing-html');
    url.searchParams.set('q', request.query);
    url.searchParams.set('setlang', 'zh-cn');
    url.searchParams.set('count', String(Math.max(request.limit, 10)));
    const freshness = builtInFreshness(request.freshness);
    if (freshness) url.searchParams.set('filters', freshness);
    const response = await this.transport.send({
      url: url.toString(),
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6'
      },
      signal: request.signal
    });
    const hits = parseBingHtmlHits(await requireOk(response, 'Bing HTML 搜索'));
    if (!hits.length) throw new Error('Bing HTML 搜索没有返回可解析的结果。');
    return hits.slice(0, request.limit);
  }

  private async searchDuckDuckGo(request: WebSearchRequest): Promise<WebSearchHit[]> {
    let primaryError: unknown;
    try {
      const hits = await this.requestDuckDuckGo(request, 'html');
      if (hits.length) return hits;
      primaryError = new Error('DuckDuckGo HTML 搜索没有返回可解析的结果。');
    } catch (error) {
      primaryError = error;
    }
    request.signal?.throwIfAborted();
    try {
      const hits = await this.requestDuckDuckGo(request, 'lite');
      if (hits.length) return hits;
      throw new Error('DuckDuckGo Lite 返回了验证页或空结果。');
    } catch (liteError) {
      request.signal?.throwIfAborted();
      throw new Error(compactSearchFailure(primaryError, liteError));
    }
  }

  private async requestDuckDuckGo(
    request: WebSearchRequest,
    variant: 'html' | 'lite'
  ): Promise<WebSearchHit[]> {
    const origin = devProxyOrigin();
    const url = new URL(origin
      ? `${origin}/__web-research/search`
      : variant === 'lite'
        ? 'https://lite.duckduckgo.com/lite/'
        : 'https://html.duckduckgo.com/html/');
    if (origin) url.searchParams.set('engine', variant === 'lite' ? 'duckduckgo-lite' : 'duckduckgo');
    url.searchParams.set('q', request.query);
    url.searchParams.set('kl', 'cn-zh');
    const freshness = duckDuckGoFreshness(request.freshness);
    if (freshness) url.searchParams.set('df', freshness);
    const response = await this.transport.send({
      url: url.toString(),
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6'
      },
      signal: request.signal
    });
    return parseDuckDuckGoHits(await requireOk(response, `DuckDuckGo ${variant === 'lite' ? 'Lite' : 'HTML'} 搜索`))
      .slice(0, request.limit);
  }

  private async searchSogouHtml(request: WebSearchRequest): Promise<WebSearchHit[]> {
    const origin = devProxyOrigin();
    const url = new URL(origin
      ? `${origin}/__web-research/search`
      : 'https://www.sogou.com/web');
    if (origin) url.searchParams.set('engine', 'sogou');
    url.searchParams.set('query', request.query);
    url.searchParams.set('ie', 'utf8');
    const response = await this.transport.send({
      url: url.toString(),
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6'
      },
      signal: request.signal
    });
    const hits = parseSogouHtmlHits(await requireOk(response, '搜狗 HTML 搜索'));
    if (!hits.length) throw new Error('搜狗 HTML 搜索没有返回可解析的结果。');
    return hits.slice(0, request.limit);
  }

  async readPage(value: string, signal?: AbortSignal, options?: WebPageReadOptions): Promise<WebPageResponse> {
    const target = requirePublicWebUrl(value);
    let readerResult: WebPageResponse | undefined;
    let readerError: unknown;
    try {
      readerResult = await this.readPageWithJina(target, signal, options);
      if (!isInsufficientPage(readerResult) || target.pathname.toLowerCase().endsWith('.pdf')) {
        return readerResult;
      }
    } catch (error) {
      readerError = error;
    }
    signal?.throwIfAborted();
    try {
      const directResult = await this.readPageDirect(target, signal, options);
      return !readerResult || directResult.content.length > readerResult.content.length
        ? directResult
        : readerResult;
    } catch (directError) {
      signal?.throwIfAborted();
      if (readerResult) return readerResult;
      throw new Error(`网页读取暂时不可用：${compactSearchFailure(readerError, directError)}`);
    }
  }

  private async readPageWithJina(target: URL, signal?: AbortSignal, options?: WebPageReadOptions): Promise<WebPageResponse> {
    // The bounded reader handles HTML and PDF consistently before a direct HTML fallback.
    const readerUrl = `https://r.jina.ai/${target.toString()}`;
    const response = await this.transport.send({
      url: readerUrl,
      method: 'GET',
      headers: jinaHeaders(
        this.config.provider === WebSearchProvider.Jina ? this.config.apiKey : '',
        'text/plain'
      ),
      signal
    });
    const raw = await requireOk(response, '网页读取');
    const contentType = response.headers.get('content-type') || '';
    const content = contentType.includes('html') ? htmlToText(raw) : extractJinaContent(raw);
    if (!content.trim()) throw new Error('网页没有可读取的正文。');
    return {
      title: extractTitle(raw) || target.hostname,
      url: target.toString(),
      domain: target.hostname,
      content: selectPageContent(content, options),
      fetchedAt: Date.now()
    };
  }

  private async readPageDirect(target: URL, signal?: AbortSignal, options?: WebPageReadOptions): Promise<WebPageResponse> {
    const origin = devProxyOrigin();
    const url = origin ? new URL(`${origin}/__web-research/read`) : target;
    if (origin) url.searchParams.set('url', target.toString());
    const response = await this.transport.send({
      url: url.toString(),
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6'
      },
      signal
    });
    const raw = await requireOk(response, '网页直读');
    const contentType = response.headers.get('content-type') || '';
    const content = contentType.includes('html') ? htmlToText(raw) : raw;
    if (!content.trim()) throw new Error('网页直读没有返回正文。');
    const resolvedTarget = publicResponseUrl(response, target);
    return {
      title: extractTitle(raw) || resolvedTarget.hostname,
      url: resolvedTarget.toString(),
      domain: resolvedTarget.hostname,
      content: selectPageContent(content, options),
      fetchedAt: Date.now()
    };
  }

  private async searchBrave(request: WebSearchRequest): Promise<WebSearchResponse> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', request.query);
    url.searchParams.set('count', String(request.limit));
    url.searchParams.set('country', 'CN');
    url.searchParams.set('search_lang', 'zh-hans');
    url.searchParams.set('ui_lang', 'zh-CN');
    url.searchParams.set('safesearch', 'strict');
    url.searchParams.set('extra_snippets', 'true');
    const freshness = braveFreshness(request.freshness);
    if (freshness) url.searchParams.set('freshness', freshness);
    const response = await this.transport.send({
      url: url.toString(),
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': this.config.apiKey
      },
      signal: request.signal
    });
    const raw = await requireOk(response, '网络搜索');
    return {
      query: request.query,
      hits: parseBraveHits(raw).slice(0, request.limit),
      fetchedAt: Date.now()
    };
  }

  private async searchJina(request: WebSearchRequest, apiKey = this.config.apiKey): Promise<WebSearchResponse> {
    const url = new URL(`https://s.jina.ai/${encodeURIComponent(request.query)}`);
    url.searchParams.set('count', String(request.limit));
    const response = await this.transport.send({
      url: url.toString(),
      method: 'GET',
      headers: jinaHeaders(apiKey, 'application/json'),
      signal: request.signal
    });
    const raw = await requireOk(response, '网络搜索');
    const hits = parseJinaHits(raw).slice(0, request.limit);
    return { query: request.query, hits, fetchedAt: Date.now() };
  }
}

function compactSearchFailure(...failures: unknown[]): string {
  const messages = failures
    .map((error) => error instanceof Error ? error.message : '')
    .filter(Boolean)
    .map((message) => message.replace(/AI 网络请求失败：/g, '').slice(0, 120));
  return [...new Set(messages)].join('；') || '当前网络没有返回有效结果，请稍后重试。';
}

function devProxyOrigin(): string | undefined {
  return import.meta.env.DEV && typeof window !== 'undefined' ? window.location.origin : undefined;
}

function jinaHeaders(apiKey: string, accept: string): Record<string, string> {
  return {
    Accept: accept,
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    'X-Respond-With': 'markdown'
  };
}

function braveFreshness(value: WebSearchRequest['freshness']): string | undefined {
  return ({ day: 'pd', week: 'pw', month: 'pm', year: 'py' } as Record<string, string>)[value];
}

function builtInFreshness(value: WebSearchRequest['freshness']): string | undefined {
  return ({
    day: 'ex1:"ez1"',
    week: 'ex1:"ez2"',
    month: 'ex1:"ez3"',
    year: 'ex1:"ez5"'
  } as Record<string, string>)[value];
}

function duckDuckGoFreshness(value: WebSearchRequest['freshness']): string | undefined {
  return ({ day: 'd', week: 'w', month: 'm', year: 'y' } as Record<string, string>)[value];
}

async function requireOk(response: Response, operation: string): Promise<string> {
  const text = await response.text();
  if (response.ok) return text;
  let message = text.slice(0, 300);
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    message = String(body.readableMessage || body.message || body.detail || message);
  } catch {
    // Keep the bounded response body as the diagnostic.
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`网络搜索密钥无效或无权限：${message}`);
  }
  if (response.status === 429) throw new Error('网络搜索服务请求过于频繁，请稍后重试。');
  throw new Error(`${operation}失败（${response.status}）：${message}`);
}

function publicResponseUrl(response: Response, fallback: URL): URL {
  const values = [
    response.headers.get('x-web-research-final-url'),
    response.headers.get('x-platform-final-url'),
    response.url
  ];
  for (const value of values) {
    try {
      if (value) return requirePublicWebUrl(value);
    } catch {
      // Development proxies and malformed redirect metadata are ignored.
    }
  }
  return fallback;
}

function extractJinaContent(raw: string): string {
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data)
      ? body.data as Record<string, unknown>
      : {};
    return String(data.content || body.content || raw);
  } catch {
    return raw;
  }
}

function htmlToText(html: string): string {
  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(html, 'text/html');
    document.querySelectorAll('script,style,noscript,svg,nav,footer').forEach((node) => node.remove());
    return document.body.textContent?.replace(/\s+/g, ' ').trim() || '';
  }
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(raw: string): string {
  const markdown = raw.match(/(?:^|\n)Title:\s*(.+)/i)?.[1]?.trim();
  const html = raw.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  return markdown || html || '';
}

function isInsufficientPage(page: WebPageResponse): boolean {
  const content = page.content.trim();
  if (content.length < 500) return true;
  return /^(?:Title|URL Source|Published Time|Markdown Content):/m.test(content)
    && content.replace(/^(?:Title|URL Source|Published Time|Markdown Content):.*$/gmi, '').trim().length < 320;
}

function selectPageContent(value: string, options?: WebPageReadOptions): string {
  const source = compact(value, MAX_PAGE_SOURCE_CHARS);
  const maxStart = Math.max(0, source.length - MAX_PAGE_CHARS);
  const requestedOffset = Number(options?.offset);
  // Tool schemas commonly materialize an omitted numeric field as 0. A real
  // positive offset requests a chunk; zero must still allow semantic focus.
  const start = Number.isFinite(requestedOffset) && requestedOffset > 0
    ? Math.min(maxStart, Math.round(requestedOffset))
    : bestFocusOffset(source, options?.focus, maxStart);
  const content = source.slice(start, start + MAX_PAGE_CHARS).trim();
  if (start === 0 && source.length <= MAX_PAGE_CHARS) return content;
  return `[正文片段 ${start}-${Math.min(source.length, start + MAX_PAGE_CHARS)} / ${source.length}]\n${content}`;
}

function bestFocusOffset(source: string, focus: string | undefined, maxStart: number): number {
  const terms = [...new Set((focus || '')
    .normalize('NFKC')
    .split(/[\s,，、;；:：|/]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2))];
  if (!terms.length) return 0;
  const candidates = new Set<number>();
  const lowered = source.toLocaleLowerCase();
  terms.forEach((term) => {
    const needle = term.toLocaleLowerCase();
    let from = 0;
    for (let count = 0; count < 20; count += 1) {
      const index = lowered.indexOf(needle, from);
      if (index < 0) break;
      candidates.add(Math.min(maxStart, Math.max(0, index - 1_200)));
      from = index + needle.length;
    }
  });
  let best = { start: 0, score: 0 };
  candidates.forEach((start) => {
    const window = source.slice(start, start + MAX_PAGE_CHARS);
    const termScore = terms.filter((term) => window.toLocaleLowerCase().includes(term.toLocaleLowerCase())).length * 12;
    const questionScore = Math.min(30, (window.match(/(?:^|\n)\s*\d{1,3}[.、．]/gm) || []).length);
    const optionScore = Math.min(20, (window.match(/(?:^|\n)\s*[A-DＡ-Ｄ][.、．]/gm) || []).length);
    const score = termScore + questionScore + optionScore;
    if (score > best.score) best = { start, score };
  });
  return best.start;
}

function compact(value: string, max: number): string {
  const text = value.replace(/\0/g, '').trim();
  return text.length > max ? `${text.slice(0, max)}\n[内容已截断]` : text;
}
