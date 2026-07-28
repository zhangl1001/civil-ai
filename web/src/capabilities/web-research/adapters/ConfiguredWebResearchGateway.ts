import type { HttpTransport } from '@/capabilities/ai-runtime/public';
import type { WebResearchConfig } from '../domain/WebResearchConfig';
import { WebSearchProvider } from '../domain/WebResearchConfig';
import { requirePublicWebUrl } from '../domain/WebUrlPolicy';
import type {
  WebPageResponse,
  WebResearchGateway,
  WebSearchHit,
  WebSearchRequest,
  WebSearchResponse
} from '../contracts/WebResearchGateway';

const MAX_PAGE_CHARS = 24_000;

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
    const raw = await requireOk(response, '内置网络搜索');
    const hits = parseRssHits(raw).slice(0, request.limit);
    if (!hits.length) throw new Error('内置网络搜索没有返回可用结果，请调整关键词或改用其他搜索服务。');
    return { query: request.query, hits, fetchedAt: Date.now() };
  }

  async readPage(value: string, signal?: AbortSignal): Promise<WebPageResponse> {
    const target = requirePublicWebUrl(value);
    // All arbitrary pages are read through the bounded reader service so a model-selected
    // URL can never make the iOS device connect directly to a LAN or loopback target.
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
      content: compact(content, MAX_PAGE_CHARS),
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
    const body = parseJson(raw);
    const rows = asArray(asRecord(body.web).results);
    return {
      query: request.query,
      hits: rows.map(parseBraveHit).filter(isHit).slice(0, request.limit),
      fetchedAt: Date.now()
    };
  }

  private async searchJina(request: WebSearchRequest): Promise<WebSearchResponse> {
    const url = new URL(`https://s.jina.ai/${encodeURIComponent(request.query)}`);
    url.searchParams.set('count', String(request.limit));
    const response = await this.transport.send({
      url: url.toString(),
      method: 'GET',
      headers: jinaHeaders(this.config.apiKey, 'application/json'),
      signal: request.signal
    });
    const raw = await requireOk(response, '网络搜索');
    const hits = parseJinaHits(raw).slice(0, request.limit);
    return { query: request.query, hits, fetchedAt: Date.now() };
  }
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

function parseBraveHit(value: unknown): WebSearchHit | undefined {
  const row = asRecord(value);
  const url = safeResultUrl(row.url);
  if (!url) return undefined;
  const snippets = asArray(row.extra_snippets).map(String).filter(Boolean);
  return {
    title: String(row.title || url.hostname),
    url: url.toString(),
    domain: url.hostname,
    snippet: compact([row.description, ...snippets].filter(Boolean).join('\n'), 3_000),
    publishedAt: optionalString(row.page_age)
  };
}

function parseJinaHits(raw: string): WebSearchHit[] {
  const body = parseJson(raw);
  const data = body.data;
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(asRecord(data).results)
      ? asRecord(data).results as unknown[]
      : [];
  const structured = rows.flatMap((value): WebSearchHit[] => {
    const row = asRecord(value);
    const url = safeResultUrl(row.url);
    if (!url) return [];
    const content = optionalString(row.content || row.raw_content);
    const publishedAt = optionalString(row.publishedTime || row.published_at);
    return [{
      title: String(row.title || url.hostname),
      url: url.toString(),
      domain: url.hostname,
      snippet: compact(String(row.description || row.snippet || ''), 3_000),
      ...(content ? { content: content.slice(0, 8_000) } : {}),
      ...(publishedAt ? { publishedAt } : {})
    }];
  });
  if (structured.length) return structured;

  const content = String(asRecord(data).content || body.content || raw);
  const links = [...content.matchAll(/\[([^\]]{2,240})\]\((https?:\/\/[^)\s]+)\)/g)];
  const seen = new Set<string>();
  return links.flatMap((match) => {
    const url = safeResultUrl(match[2]);
    if (!url || seen.has(url.toString())) return [];
    seen.add(url.toString());
    const start = Math.max(0, (match.index || 0) - 120);
    const end = Math.min(content.length, (match.index || 0) + match[0].length + 600);
    return [{
      title: match[1].trim(),
      url: url.toString(),
      domain: url.hostname,
      snippet: compact(content.slice(start, end), 1_200)
    }];
  });
}

function parseRssHits(raw: string): WebSearchHit[] {
  const items = [...raw.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  return items.flatMap((match): WebSearchHit[] => {
    const item = match[1];
    const url = safeResultUrl(xmlValue(item, 'link'));
    if (!url) return [];
    const title = compact(decodeMarkup(xmlValue(item, 'title')), 240) || url.hostname;
    const snippet = compact(decodeMarkup(xmlValue(item, 'description')), 3_000);
    const publishedAt = optionalString(decodeMarkup(xmlValue(item, 'pubDate')));
    return [{
      title,
      url: url.toString(),
      domain: url.hostname,
      snippet,
      ...(publishedAt ? { publishedAt } : {})
    }];
  });
}

function xmlValue(block: string, tag: string): string {
  return block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]?.trim() || '';
}

function decodeMarkup(value: string): string {
  const withoutCdata = value.replace(/^<!\[CDATA\[|\]\]>$/g, '');
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const decoded = parser
      .parseFromString(`<body>${withoutCdata}</body>`, 'text/html')
      .body.textContent || '';
    return (decoded.includes('<')
      ? parser.parseFromString(`<body>${decoded}</body>`, 'text/html').body.textContent || ''
      : decoded
    ).replace(/\s+/g, ' ').trim();
  }
  return withoutCdata
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractJinaContent(raw: string): string {
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    return String(asRecord(body.data).content || body.content || raw);
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

function safeResultUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return requirePublicWebUrl(value);
  } catch {
    return undefined;
  }
}

function parseJson(raw: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return { content: raw };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isHit(value: WebSearchHit | undefined): value is WebSearchHit {
  return Boolean(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function compact(value: string, max: number): string {
  const text = value.replace(/\0/g, '').trim();
  return text.length > max ? `${text.slice(0, max)}\n[内容已截断]` : text;
}
