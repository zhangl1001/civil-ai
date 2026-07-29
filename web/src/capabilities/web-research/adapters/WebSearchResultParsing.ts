import type { WebSearchHit } from '../contracts/WebResearchGateway';
import { requirePublicWebUrl } from '../domain/WebUrlPolicy';

export function parseBraveHits(raw: string): WebSearchHit[] {
  const body = parseJson(raw);
  return asArray(asRecord(body.web).results)
    .map(parseBraveHit)
    .filter(isHit);
}

export function parseJinaHits(raw: string): WebSearchHit[] {
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

export function parseRssHits(raw: string): WebSearchHit[] {
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

export function parseBingHtmlHits(raw: string): WebSearchHit[] {
  const blocks = [...raw.matchAll(/<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)];
  const seen = new Set<string>();
  return blocks.flatMap((match): WebSearchHit[] => {
    const block = match[1];
    const link = block.match(/<h2\b[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const url = bingResultUrl(link?.[1]);
    if (!url || seen.has(url.toString())) return [];
    seen.add(url.toString());
    const snippet = block.match(/<div\b[^>]*class=["'][^"']*\bb_caption\b[^"']*["'][^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '';
    return [{
      title: compact(decodeMarkup(link?.[2] || ''), 240) || url.hostname,
      url: url.toString(),
      domain: url.hostname,
      snippet: compact(decodeMarkup(snippet), 3_000)
    }];
  });
}

export function parseDuckDuckGoHits(raw: string): WebSearchHit[] {
  const htmlBlocks = [...raw.matchAll(/<div\b[^>]*class=["'][^"']*\bresult\b[^"']*["'][^>]*>([\s\S]*?)<div\b[^>]*class=["'][^"']*\bclear\b[^"']*["'][^>]*>\s*<\/div>/gi)]
    .map((match) => match[1]);
  const liteBlocks = [...raw.matchAll(/<tr\b[^>]*>[\s\S]*?<a\b[^>]*class=["'][^"']*\bresult-link\b[^"']*["'][^>]*>[\s\S]*?<\/tr>/gi)]
    .map((match) => match[0]);
  const seen = new Set<string>();
  return [...htmlBlocks, ...liteBlocks].flatMap((block): WebSearchHit[] => {
    const link = block.match(/<a\b(?=[^>]*class=["'][^"']*\b(?:result__a|result-link)\b[^"']*["'])[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const url = duckDuckGoResultUrl(link?.[1]);
    if (!url || seen.has(url.toString())) return [];
    seen.add(url.toString());
    const snippet = block.match(/<(?:a|td)\b(?=[^>]*class=["'][^"']*\b(?:result__snippet|result-snippet)\b[^"']*["'])[^>]*>([\s\S]*?)<\/(?:a|td)>/i)?.[1] || '';
    return [{
      title: compact(decodeMarkup(link?.[2] || ''), 240) || url.hostname,
      url: url.toString(),
      domain: url.hostname,
      snippet: compact(decodeMarkup(snippet), 3_000)
    }];
  });
}

export function parseSogouHtmlHits(raw: string): WebSearchHit[] {
  const blocks = raw
    .split(/<div\b[^>]*class=["'][^"']*\bvrwrap\b[^"']*["'][^>]*>/gi)
    .slice(1);
  const seen = new Set<string>();
  return blocks.flatMap((block): WebSearchHit[] => {
    const link = block.match(/<h3\b[^>]*class=["'][^"']*\bvr-title\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) return [];
    const directValue = block.match(/\bdata-url=["']([^"']+)["']/i)?.[1];
    const url = safeResultUrl(decodeMarkup(directValue || '')) || sogouResultUrl(link[1]);
    if (!url || seen.has(url.toString())) return [];
    seen.add(url.toString());
    const snippets = [...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((match) => decodeMarkup(match[1]))
      .filter((value) => value.length >= 12)
      .sort((left, right) => right.length - left.length);
    return [{
      title: compact(decodeMarkup(link[2]), 240) || url.hostname,
      url: url.toString(),
      domain: url.hostname,
      snippet: compact(snippets[0] || '', 3_000)
    }];
  });
}

export function relevantSearchHits(query: string, hits: readonly WebSearchHit[]): WebSearchHit[] {
  if (!hits.length) return [];
  const signals = searchSignals(query);
  const hasSignals = signals.semantic.size || signals.ascii.size || signals.years.size || signals.site;
  return hits
    .map((hit, index) => ({ hit, index, relevance: searchHitRelevance(signals, hit) }))
    .filter(({ relevance }) => !hasSignals || relevance.relevant)
    .sort((left, right) => right.relevance.score - left.relevance.score || left.index - right.index)
    .map(({ hit }) => hit);
}

export function mergeSearchHits(...groups: readonly (readonly WebSearchHit[])[]): WebSearchHit[] {
  const merged = new Map<string, WebSearchHit>();
  for (const hit of groups.flat()) {
    const key = canonicalSearchResultUrl(hit.url);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, hit);
      continue;
    }
    merged.set(key, {
      ...existing,
      title: existing.title.length >= hit.title.length ? existing.title : hit.title,
      snippet: existing.snippet.length >= hit.snippet.length ? existing.snippet : hit.snippet,
      ...(existing.content || hit.content ? { content: existing.content || hit.content } : {}),
      ...(existing.publishedAt || hit.publishedAt ? { publishedAt: existing.publishedAt || hit.publishedAt } : {})
    });
  }
  return [...merged.values()];
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

function bingResultUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  const decoded = decodeMarkup(value);
  try {
    const redirect = new URL(decoded);
    if (!redirect.hostname.endsWith('bing.com')) return safeResultUrl(redirect.toString());
    const encoded = redirect.searchParams.get('u');
    if (!encoded) return undefined;
    const payload = encoded.startsWith('a1') ? encoded.slice(2) : encoded;
    return safeResultUrl(decodeBase64Url(payload));
  } catch {
    return undefined;
  }
}

function duckDuckGoResultUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  const decoded = decodeMarkup(value);
  try {
    const redirect = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded);
    const target = redirect.hostname.endsWith('duckduckgo.com')
      ? redirect.searchParams.get('uddg')
      : redirect.toString();
    return safeResultUrl(target);
  } catch {
    return undefined;
  }
}

function sogouResultUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    return safeResultUrl(new URL(decodeMarkup(value), 'https://www.sogou.com').toString());
  } catch {
    return undefined;
  }
}

function decodeBase64Url(value: string): string | undefined {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = atob(padded);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

function searchSignals(query: string): SearchSignals {
  const normalized = query.normalize('NFKC').toLowerCase();
  const site = normalized.match(/(?:^|\s)site:([^\s]+)/)?.[1]?.replace(/^www\./, '');
  const semantic = new Set<string>();
  for (const segment of normalized.match(/[\u3400-\u9fff]+/g) || []) {
    if (segment.length < 2) continue;
    if (segment.length <= 12) semantic.add(segment);
    if (segment.length >= 4) {
      for (let index = 0; index < segment.length - 1; index += 1) {
        semantic.add(segment.slice(index, index + 2));
      }
    }
  }
  const ascii = new Set(
    (normalized.replace(/(?:^|\s)site:[^\s]+/g, ' ').match(/[a-z][a-z0-9_-]{1,}/g) || [])
      .filter((value) => !/^\d+$/.test(value))
  );
  const years = new Set(normalized.match(/(?:19|20)\d{2}/g) || []);
  return { semantic, ascii, years, ...(site ? { site } : {}) };
}

function searchHitRelevance(signals: SearchSignals, hit: WebSearchHit): { readonly score: number; readonly relevant: boolean } {
  const text = `${hit.title} ${hit.snippet} ${hit.domain}`.normalize('NFKC').toLowerCase();
  const title = hit.title.normalize('NFKC').toLowerCase();
  const semanticMatches = [...signals.semantic].filter((term) => text.includes(term)).length;
  const titleMatches = [...signals.semantic].filter((term) => title.includes(term)).length;
  const asciiMatches = [...signals.ascii].filter((term) => text.includes(term)).length;
  const yearMatches = [...signals.years].filter((term) => text.includes(term)).length;
  const siteMatches = Boolean(signals.site && hit.domain.replace(/^www\./, '').endsWith(signals.site));
  const semanticTarget = signals.semantic.size <= 4 ? 1 : 2;
  const relevant = siteMatches
    || semanticMatches >= semanticTarget
    || (signals.semantic.size === 0 && (asciiMatches > 0 || yearMatches > 0));
  return {
    score: (siteMatches ? 20 : 0)
      + semanticMatches * 3
      + titleMatches * 2
      + asciiMatches * 2
      + yearMatches
      + (/\.pdf(?:$|[?#])/i.test(hit.url) ? 8 : 0),
    relevant
  };
}

function canonicalSearchResultUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
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

interface SearchSignals {
  readonly semantic: ReadonlySet<string>;
  readonly ascii: ReadonlySet<string>;
  readonly years: ReadonlySet<string>;
  readonly site?: string;
}
