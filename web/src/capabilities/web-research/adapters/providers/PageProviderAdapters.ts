import { Readability } from '@mozilla/readability';
import type { HttpTransport } from '@/capabilities/ai-runtime/public';
import type { WebPageReadOptions, WebPageResponse } from '../../contracts/WebResearchGateway';
import type { WebPageProviderAdapter } from '../../contracts/WebResearchProvider';
import { requirePublicWebUrl } from '../../domain/WebUrlPolicy';
import {
  publicResponseUrl,
  requireWebResponse,
  webResearchProxyOrigin
} from '../WebResearchHttp';

const MAX_PAGE_CHARS = 24_000;
const MAX_PAGE_SOURCE_CHARS = 160_000;

export class JinaReaderProviderAdapter implements WebPageProviderAdapter {
  readonly id = 'jina-reader';
  readonly configured = true;

  constructor(
    private readonly transport: HttpTransport,
    private readonly apiKey = ''
  ) {}

  async read(target: URL, signal?: AbortSignal, options?: WebPageReadOptions): Promise<WebPageResponse> {
    const response = await this.transport.send({
      url: `https://r.jina.ai/${target.toString()}`,
      method: 'GET',
      headers: {
        Accept: 'text/plain',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        'X-Respond-With': 'markdown'
      },
      signal
    });
    const raw = await requireWebResponse(response, 'Jina Reader');
    const content = extractJinaContent(raw);
    if (!content.trim()) throw new Error('Jina Reader 没有返回正文。');
    return {
      title: extractTitle(raw) || target.hostname,
      url: target.toString(),
      domain: target.hostname,
      content: selectPageContent(content, options),
      fetchedAt: Date.now(),
      provider: this.id
    };
  }
}

export class FirecrawlPageProviderAdapter implements WebPageProviderAdapter {
  readonly id = 'firecrawl';
  readonly configured: boolean;

  constructor(
    private readonly transport: HttpTransport,
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.firecrawl.dev'
  ) {
    this.configured = Boolean(apiKey);
  }

  async read(target: URL, signal?: AbortSignal, options?: WebPageReadOptions): Promise<WebPageResponse> {
    const response = await this.transport.send({
      url: new URL('/v2/scrape', normalizeBaseUrl(this.baseUrl)).toString(),
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: target.toString(),
        formats: ['markdown'],
        onlyMainContent: true,
        timeout: 10_000
      }),
      signal
    });
    const raw = await requireWebResponse(response, 'Firecrawl 网页读取');
    const body = JSON.parse(raw) as Record<string, unknown>;
    const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data)
      ? body.data as Record<string, unknown>
      : {};
    const metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
      ? data.metadata as Record<string, unknown>
      : {};
    const content = String(data.markdown || data.content || '');
    if (!content.trim()) throw new Error('Firecrawl 没有返回正文。');
    const resolved = safePublicUrl(metadata.sourceURL || metadata.url) || target;
    return {
      title: String(metadata.title || target.hostname),
      url: resolved.toString(),
      domain: resolved.hostname,
      content: selectPageContent(content, options),
      fetchedAt: Date.now(),
      provider: this.id
    };
  }
}

export class NativeReadabilityProviderAdapter implements WebPageProviderAdapter {
  readonly id = 'native-readability';
  readonly configured = true;

  constructor(private readonly transport: HttpTransport) {}

  async read(target: URL, signal?: AbortSignal, options?: WebPageReadOptions): Promise<WebPageResponse> {
    const proxy = webResearchProxyOrigin();
    const url = proxy ? new URL(`${proxy}/__web-research/read`) : target;
    if (proxy) url.searchParams.set('url', target.toString());
    const response = await this.transport.send({
      url: url.toString(),
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6'
      },
      signal
    });
    const raw = await requireWebResponse(response, '原生网页读取');
    const contentType = response.headers.get('content-type') || '';
    const article = contentType.includes('html') ? readableArticle(raw, target.toString()) : undefined;
    const content = article?.content || raw;
    if (!content.trim()) throw new Error('原生网页读取没有返回正文。');
    const resolved = publicResponseUrl(response, target);
    return {
      title: article?.title || extractTitle(raw) || resolved.hostname,
      url: resolved.toString(),
      domain: resolved.hostname,
      content: selectPageContent(content, options),
      fetchedAt: Date.now(),
      provider: this.id
    };
  }
}

export function isInsufficientWebDocument(page: WebPageResponse): boolean {
  const content = page.content.trim();
  if (content.length < 500) return true;
  return /^(?:Title|URL Source|Published Time|Markdown Content):/m.test(content)
    && content.replace(/^(?:Title|URL Source|Published Time|Markdown Content):.*$/gmi, '').trim().length < 320;
}

function readableArticle(html: string, url: string): { readonly title: string; readonly content: string } | undefined {
  if (typeof DOMParser === 'undefined') return {
    title: extractTitle(html),
    content: stripHtml(html)
  };
  const document = new DOMParser().parseFromString(html, 'text/html');
  const base = document.createElement('base');
  base.href = url;
  document.head.prepend(base);
  const article = new Readability(document).parse();
  if (!article?.textContent?.trim()) return {
    title: document.title,
    content: stripHtml(html)
  };
  return {
    title: article.title || document.title,
    content: article.textContent.replace(/\n{3,}/g, '\n\n').trim()
  };
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

function extractTitle(raw: string): string {
  return raw.match(/(?:^|\n)Title:\s*(.+)/i)?.[1]?.trim()
    || raw.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim()
    || '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function selectPageContent(value: string, options?: WebPageReadOptions): string {
  const source = compact(value, MAX_PAGE_SOURCE_CHARS);
  const maxStart = Math.max(0, source.length - MAX_PAGE_CHARS);
  const requestedOffset = Number(options?.offset);
  const start = Number.isFinite(requestedOffset) && requestedOffset > 0
    ? Math.min(maxStart, Math.round(requestedOffset))
    : bestFocusOffset(source, options?.focus, maxStart);
  const content = source.slice(start, start + MAX_PAGE_CHARS).trim();
  if (start === 0 && source.length <= MAX_PAGE_CHARS) return content;
  return `[正文片段 ${start}-${Math.min(source.length, start + MAX_PAGE_CHARS)} / ${source.length}]\n${content}`;
}

function bestFocusOffset(source: string, focus: string | undefined, maxStart: number): number {
  const terms = [...new Set((focus || '').normalize('NFKC')
    .split(/[\s,，、;；:：|/]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2))];
  if (!terms.length) return 0;
  const lowered = source.toLocaleLowerCase();
  let best = { start: 0, score: 0 };
  terms.forEach((term) => {
    const index = lowered.indexOf(term.toLocaleLowerCase());
    if (index < 0) return;
    const start = Math.min(maxStart, Math.max(0, index - 1_200));
    const window = lowered.slice(start, start + MAX_PAGE_CHARS);
    const score = terms.filter((value) => window.includes(value.toLocaleLowerCase())).length;
    if (score > best.score) best = { start, score };
  });
  return best.start;
}

function compact(value: string, max: number): string {
  const text = value.replace(/\0/g, '').trim();
  return text.length > max ? `${text.slice(0, max)}\n[内容已截断]` : text;
}

function safePublicUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return requirePublicWebUrl(value);
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
