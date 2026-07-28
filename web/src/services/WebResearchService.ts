import {
  ConfiguredWebResearchGateway,
  WebSearchFreshness,
  WebSearchProvider,
  type WebPageResponse,
  type WebSearchFreshnessCode,
  type WebSearchResponse
} from '@/capabilities/web-research/public';
import { PlatformHttpTransport } from '@/composition-root/ai/PlatformHttpTransport';
import { webResearchConfigService } from './WebResearchConfigService';

const SESSION_TTL_MS = 15 * 60_000;
const MAX_SESSIONS = 24;
const MAX_URLS_PER_SESSION = 20;

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
  readonly urls: ReadonlySet<string>;
}

export class WebResearchService {
  private readonly sessions = new Map<string, SearchSession>();

  async isConfigured(): Promise<boolean> {
    const config = await webResearchConfigService.load();
    return config.enabled && (
      config.provider === WebSearchProvider.BuiltIn || Boolean(config.apiKey)
    );
  }

  async search(input: {
    readonly query: string;
    readonly freshness?: WebSearchFreshnessCode;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  }): Promise<WebSearchResponse> {
    const query = normalizeQuery(input.query);
    const gateway = await this.gateway();
    const result = await gateway.search({
      query,
      freshness: input.freshness ?? WebSearchFreshness.Any,
      limit: clampLimit(input.limit),
      signal: input.signal
    });
    if (!result.hits.length) throw new Error('网络搜索没有找到可用结果，请调整关键词。');
    return result;
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
    const existing = this.sessions.get(input.agentRunId);
    const urls = new Set([
      ...(existing?.expiresAt && existing.expiresAt > Date.now() ? existing.urls : []),
      ...result.hits.map((hit) => hit.url)
    ]);
    while (urls.size > MAX_URLS_PER_SESSION) {
      const oldest = urls.values().next().value as string | undefined;
      if (!oldest) break;
      urls.delete(oldest);
    }
    this.sessions.set(input.agentRunId, {
      expiresAt: Date.now() + SESSION_TTL_MS,
      urls
    });
    return result;
  }

  async readPageForAgentRun(input: {
    readonly agentRunId: string;
    readonly url: string;
    readonly signal?: AbortSignal;
  }): Promise<WebPageResponse> {
    this.pruneSessions();
    const session = this.sessions.get(input.agentRunId);
    if (!session?.urls.has(input.url)) {
      throw new Error('只能读取当前 Agent 运行中 web.search 返回的网页，请先搜索。');
    }
    return (await this.gateway()).readPage(input.url, input.signal);
  }

  async collectDailyHotspots(date: string, signal?: AbortSignal): Promise<{
    readonly query: string;
    readonly evidence: string;
    readonly sources: readonly WebResearchSource[];
  }> {
    const query = `${date} 中国 时政 政策 治理 公务员考试 申论 热点 新华社 国务院 人民日报`;
    const result = await this.search({
      query,
      freshness: WebSearchFreshness.Week,
      limit: 5,
      signal
    });
    const sources = result.hits.map((hit) => ({
      title: hit.title,
      url: hit.url,
      domain: hit.domain,
      snippet: compact(hit.content || hit.snippet, 2_400),
      ...(hit.publishedAt ? { publishedAt: hit.publishedAt } : {}),
      fetchedAt: result.fetchedAt
    }));
    return {
      query,
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
    if (config.provider !== WebSearchProvider.BuiltIn && !config.apiKey) {
      throw new Error('网络搜索尚未配置 API Key，请在“我的 → AI 配置”中填写。');
    }
    return new ConfiguredWebResearchGateway(config, new PlatformHttpTransport());
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
}

export const webResearchService = new WebResearchService();

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
