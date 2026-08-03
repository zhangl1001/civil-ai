import type { WebPageResponse, WebSearchHit, WebSearchResponse } from '@/capabilities/web-research/public';
import { WebSearchFreshness } from '@/capabilities/web-research/public';
import type { WebResearchService } from '@/services/WebResearchService';

const SEARCH_LIMIT = 5;
const PAGE_LIMIT = 3;
const PREFETCH_PAGE_TARGET = 2;
const PREFETCH_PAGE_BUDGET_MS = 14_000;
const PAGE_EVIDENCE_CHARS = 4_500;

export interface TrueQuestionResearchPrefetchResult {
  readonly queries: readonly string[];
  readonly searches: readonly WebSearchResponse[];
  readonly pages: readonly WebPageResponse[];
  readonly promptEvidence: string;
}

export async function prefetchTrueQuestionResearch(input: {
  readonly agentRunId: string;
  readonly scope: string;
  readonly maxQuestions: number;
  readonly signal: AbortSignal;
  readonly research: Pick<WebResearchService, 'searchForAgentRun' | 'readPageForAgentRun'>;
}): Promise<TrueQuestionResearchPrefetchResult> {
  const queries = [
    `${input.scope} 真题 完整试卷 答案`,
    `${input.scope} 真题 PDF 答案解析`
  ];
  const searchAttempts = await Promise.allSettled(queries.map((query) => input.research.searchForAgentRun({
    agentRunId: input.agentRunId,
    query,
    freshness: WebSearchFreshness.Any,
    limit: SEARCH_LIMIT,
    signal: input.signal
  })));
  input.signal.throwIfAborted();
  const searches = searchAttempts.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const candidates = uniqueSearchHits(searches.flatMap((result) => result.hits)).slice(0, PAGE_LIMIT);
  const pages = await collectUsefulPages({
    candidates,
    targetCount: PREFETCH_PAGE_TARGET,
    timeoutMs: PREFETCH_PAGE_BUDGET_MS,
    parentSignal: input.signal,
    read: (hit, signal) => input.research.readPageForAgentRun({
      agentRunId: input.agentRunId,
      url: hit.url,
      focus: input.scope,
      signal
    })
  });
  input.signal.throwIfAborted();
  return {
    queries,
    searches,
    pages,
    promptEvidence: formatPrefetchedEvidence(searches, pages, input.maxQuestions)
  };
}

async function collectUsefulPages(input: {
  readonly candidates: readonly WebSearchHit[];
  readonly targetCount: number;
  readonly timeoutMs: number;
  readonly parentSignal: AbortSignal;
  readonly read: (hit: WebSearchHit, signal: AbortSignal) => Promise<WebPageResponse>;
}): Promise<WebPageResponse[]> {
  if (!input.candidates.length) return [];
  const controllers = input.candidates.map(() => new AbortController());
  const abortChildren = () => controllers.forEach((controller) => {
    if (!controller.signal.aborted) controller.abort(input.parentSignal.reason);
  });
  input.parentSignal.addEventListener('abort', abortChildren, { once: true });
  const pending = new Map(input.candidates.map((hit, index) => [
    index,
    input.read(hit, controllers[index].signal).then(
      (page) => ({ index, page }),
      () => ({ index, page: undefined })
    )
  ]));
  const pages: WebPageResponse[] = [];
  const deadline = new Promise<{ readonly index: -1; readonly page: undefined }>((resolve) => {
    globalThis.setTimeout(() => resolve({ index: -1, page: undefined }), input.timeoutMs);
  });
  try {
    while (pending.size && pages.length < input.targetCount) {
      const settled = await Promise.race([...pending.values(), deadline]);
      if (settled.index < 0) break;
      pending.delete(settled.index);
      if (settled.page) pages.push(settled.page);
      input.parentSignal.throwIfAborted();
    }
    return pages;
  } finally {
    input.parentSignal.removeEventListener('abort', abortChildren);
    controllers.forEach((controller) => {
      if (!controller.signal.aborted) controller.abort(new Error('真题预读取已有足够候选或已达到时间预算'));
    });
  }
}

function uniqueSearchHits(hits: readonly WebSearchHit[]): WebSearchHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = canonicalUrl(hit.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatPrefetchedEvidence(
  searches: readonly WebSearchResponse[],
  pages: readonly WebPageResponse[],
  maxQuestions: number
): string {
  if (pages.length) return [
    '【系统并行预取的候选正文】',
    `以下网页已实际读取。先检查其中能否直接提取最多 ${maxQuestions} 道完整题；证据充分时立即生成草稿，证据不足时再自主调用搜索或读取工具。`,
    ...pages.map((page, index) => [
      `### 候选正文 ${index + 1}`,
      `标题：${page.title}`,
      `网址：${page.url}`,
      clip(page.content, PAGE_EVIDENCE_CHARS)
    ].join('\n'))
  ].join('\n\n');
  const hits = uniqueSearchHits(searches.flatMap((result) => result.hits)).slice(0, SEARCH_LIMIT);
  if (!hits.length) return '系统预取暂未找到可读正文，请自主调整查询策略继续研究。';
  return [
    '【系统并行预取的搜索候选】',
    '候选正文读取失败，可优先重新读取下列网址，也可自主调整搜索范围。',
    ...hits.map((hit, index) => `${index + 1}. ${hit.title}\n${hit.url}\n${hit.snippet}`)
  ].join('\n\n');
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}

function clip(value: string, max: number): string {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max)}\n[候选正文已截断，可用 web.read_page 继续读取]` : text;
}
