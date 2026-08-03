import {
  ConfiguredWebResearchGateway,
  requirePublicWebUrl,
  WebSearchFreshness,
  type WebPageResponse,
  type SearchResult,
  type WebSearchFreshnessCode,
  type WebSearchResponse
} from '@/capabilities/web-research/public';
import { PlatformHttpTransport } from '@/composition-root/ai/PlatformHttpTransport';
import { NativeHttpRequestPurpose } from '@/platform/NativeStreamingHttpAdapter';
import { buildDailyCurrentAffairsQueries, selectDailyCurrentAffairs } from './CurrentAffairsResearchPolicy';
import { webResearchConfigService } from './WebResearchConfigService';

const SESSION_TTL_MS = 15 * 60_000;
const MAX_SESSIONS = 24;
const MAX_SEARCH_URLS_PER_SESSION = 96;
const MAX_DISCOVERED_URLS_PER_SESSION = 48;
const SEARCH_CACHE_FRESH_MS = 10 * 60_000;
const SEARCH_CACHE_STALE_MS = 60 * 60_000;
const MAX_SEARCH_CACHE_ENTRIES = 48;

export interface WebResearchSource {
  readonly title: string;
  readonly url: string;
  readonly domain: string;
  readonly snippet: string;
  readonly publishedAt?: string;
  readonly fetchedAt: number;
}

interface SearchSession {
  readonly expiresAt: number;
  readonly searchUrls: ReadonlySet<string>;
  readonly discoveredUrls: ReadonlySet<string>;
}

interface CachedSearch {
  readonly response: WebSearchResponse;
  readonly freshUntil: number;
  readonly staleUntil: number;
}

export class WebResearchService {
  private readonly sessions = new Map<string, SearchSession>();
  private readonly searchCache = new Map<string, CachedSearch>();

  async isConfigured(): Promise<boolean> {
    const config = await webResearchConfigService.load();
    return config.enabled;
  }

  async search(input: {
    readonly query: string;
    readonly freshness?: WebSearchFreshnessCode;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  }): Promise<WebSearchResponse> {
    const query = normalizeQuery(input.query);
    const freshness = input.freshness ?? WebSearchFreshness.Any;
    const limit = clampLimit(input.limit);
    const cacheKey = `${freshness}\n${limit}\n${query.toLocaleLowerCase()}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached && cached.freshUntil > Date.now()) {
      this.refreshSearchCacheEntry(cacheKey, cached);
      return cached.response;
    }
    try {
      const result = await (await this.gateway()).search({
        query,
        freshness,
        limit,
        signal: input.signal
      });
      if (!result.hits.length) throw new Error('网络搜索没有找到可用结果，请调整关键词。');
      this.rememberSearch(cacheKey, result);
      return result;
    } catch (error) {
      input.signal?.throwIfAborted();
      if (cached && cached.staleUntil > Date.now()) {
        this.refreshSearchCacheEntry(cacheKey, cached);
        return cached.response;
      }
      throw error;
    }
  }

  async searchForAgentRun(input: {
    readonly agentRunId: string;
    readonly query: string;
    readonly freshness?: WebSearchFreshnessCode;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  }): Promise<WebSearchResponse> {
    const result = await this.search(input);
    this.pruneSessions();
    this.rememberUrls(input.agentRunId, result.hits.map((hit) => hit.url), 'search');
    return result;
  }

  async readPageForAgentRun(input: {
    readonly agentRunId: string;
    readonly url: string;
    readonly focus?: string;
    readonly offset?: number;
    readonly signal?: AbortSignal;
  }): Promise<WebPageResponse> {
    this.pruneSessions();
    const targetUrl = requirePublicWebUrl(input.url).toString();
    const session = this.sessions.get(input.agentRunId);
    if (!session || (!session.searchUrls.has(targetUrl) && !session.discoveredUrls.has(targetUrl))) {
      throw new Error('只能读取当前 Agent 运行中 web.search 返回的网页，请先搜索。');
    }
    const page = await (await this.gateway()).readPage(targetUrl, input.signal, {
      focus: input.focus,
      offset: input.offset
    });
    this.rememberUrls(
      input.agentRunId,
      [targetUrl],
      session.searchUrls.has(targetUrl) ? 'search' : 'discovered'
    );
    this.rememberUrls(input.agentRunId, extractPublicPageLinks(page.content), 'discovered');
    return page;
  }

  async collectDailyHotspots(date: string, signal?: AbortSignal): Promise<{
    readonly query: string;
    readonly evidence: string;
    readonly sources: readonly WebResearchSource[];
  }> {
    const queries = buildDailyCurrentAffairsQueries(date);
    const searches = await Promise.allSettled(queries.map((query) => this.search({
      query,
      freshness: WebSearchFreshness.Week,
      limit: 5,
      signal
    })));
    signal?.throwIfAborted();
    const successful = searches
      .filter((result): result is PromiseFulfilledResult<WebSearchResponse> => result.status === 'fulfilled')
      .map((result) => result.value);
    const selected = selectDailyCurrentAffairs(successful.map((result) => result.hits), 5);
    if (!selected.length) {
      const firstFailure = searches.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      throw firstFailure?.reason instanceof Error
        ? firstFailure.reason
        : new Error('近期没有检索到可核实的公考时政来源，请稍后重试。');
    }
    const detailed = await enrichCurrentAffairsEvidence(selected, await this.gateway(), signal);
    const fetchedAt = Math.max(...successful.map((result) => result.fetchedAt), Date.now());
    const sources = detailed.map((hit) => ({
      title: hit.title,
      url: hit.url,
      domain: hit.domain,
      snippet: compact(hit.content || hit.snippet, 2_400),
      ...(hit.publishedAt ? { publishedAt: hit.publishedAt } : {}),
      fetchedAt
    }));
    return {
      query: queries.join(' | '),
      evidence: sources.map((source, index) => [
        `[来源${index + 1}] ${source.title}`,
        `网址：${source.url}`,
        source.publishedAt ? `发布时间：${source.publishedAt}` : '',
        `检索内容：${source.snippet}`
      ].filter(Boolean).join('\n')).join('\n\n'),
      sources
    };
  }

  private async gateway(): Promise<ConfiguredWebResearchGateway> {
    const config = await webResearchConfigService.load();
    if (!config.enabled) throw new Error('网络搜索尚未开启，请在“我的 → AI 配置”中开启。');
    return new ConfiguredWebResearchGateway(
      config,
      new PlatformHttpTransport(NativeHttpRequestPurpose.PublicWeb)
    );
  }

  private pruneSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
    while (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (!oldest) break;
      this.sessions.delete(oldest);
    }
  }

  private rememberSearch(cacheKey: string, response: WebSearchResponse): void {
    const now = Date.now();
    this.refreshSearchCacheEntry(cacheKey, {
      response,
      freshUntil: now + SEARCH_CACHE_FRESH_MS,
      staleUntil: now + SEARCH_CACHE_STALE_MS
    });
    while (this.searchCache.size > MAX_SEARCH_CACHE_ENTRIES) {
      const oldest = this.searchCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.searchCache.delete(oldest);
    }
  }

  private refreshSearchCacheEntry(cacheKey: string, cached: CachedSearch): void {
    this.searchCache.delete(cacheKey);
    this.searchCache.set(cacheKey, cached);
  }

  private rememberUrls(
    agentRunId: string,
    values: readonly string[],
    bucket: 'search' | 'discovered'
  ): void {
    const existing = this.sessions.get(agentRunId);
    const active = existing?.expiresAt && existing.expiresAt > Date.now() ? existing : undefined;
    const searchUrls = bucket === 'search'
      ? rememberRecentPublicUrls(active?.searchUrls ?? [], values, MAX_SEARCH_URLS_PER_SESSION)
      : new Set(active?.searchUrls ?? []);
    const discoveredUrls = bucket === 'discovered'
      ? rememberRecentPublicUrls(active?.discoveredUrls ?? [], values, MAX_DISCOVERED_URLS_PER_SESSION)
      : new Set(active?.discoveredUrls ?? []);
    this.sessions.set(agentRunId, {
      expiresAt: Date.now() + SESSION_TTL_MS,
      searchUrls,
      discoveredUrls
    });
  }
}

export const webResearchService = new WebResearchService();

export function rememberRecentPublicUrls(
  existing: Iterable<string>,
  values: readonly string[],
  maxSize: number
): ReadonlySet<string> {
  const urls = new Set(existing);
  for (const value of values) {
    let normalized: string;
    try {
      normalized = requirePublicWebUrl(value).toString();
    } catch {
      continue;
    }
    // Refresh insertion order so a page being read in chunks cannot be
    // evicted by the child links discovered from that same page.
    urls.delete(normalized);
    urls.add(normalized);
  }
  while (urls.size > maxSize) {
    const oldest = urls.values().next().value as string | undefined;
    if (!oldest) break;
    urls.delete(oldest);
  }
  return urls;
}

function normalizeQuery(value: string): string {
  const query = value.replace(/\s+/g, ' ').trim();
  if (!query) throw new Error('网络搜索关键词不能为空。');
  if (query.length > 300) throw new Error('网络搜索关键词过长，请缩小范围。');
  return query;
}

function clampLimit(value?: number): number {
  const next = Number.isFinite(value) ? Math.round(value!) : 5;
  return Math.min(5, Math.max(1, next));
}

function compact(value: string, max: number): string {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max)}\n[内容已截断]` : text;
}

async function enrichCurrentAffairsEvidence(
  hits: readonly SearchResult[],
  gateway: ConfiguredWebResearchGateway,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  return Promise.all(hits.map(async (hit, index) => {
    if (index >= 3 || (hit.content?.trim().length ?? 0) >= 800) return hit;
    try {
      const page = await gateway.readPage(hit.url, signal);
      return {
        ...hit,
        title: page.title || hit.title,
        content: compact(page.content, 2_400)
      };
    } catch {
      signal?.throwIfAborted();
      return hit;
    }
  }));
}

function extractPublicPageLinks(content: string): string[] {
  const seen = new Set<string>();
  for (const match of content.matchAll(/https?:\/\/[^\s)>\]}"']+/g)) {
    try {
      const url = requirePublicWebUrl(match[0].replace(/&amp;/g, '&').replace(/[.,;:!?，。；：！？]+$/g, ''));
      seen.add(url.toString());
    } catch {
      // Ignore malformed, local, or private links discovered in remote content.
    }
    if (seen.size >= 16) break;
  }
  return [...seen];
}
