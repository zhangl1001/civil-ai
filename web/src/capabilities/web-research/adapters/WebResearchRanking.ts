import type { WebSearchHit } from '../contracts/WebResearchGateway';
import type { RankedProviderResults } from '../contracts/WebResearchProvider';
import { relevantSearchHits } from './WebSearchResultParsing';

const RRF_K = 60;

export function rankWebSearchResults(
  query: string,
  groups: readonly RankedProviderResults[],
  limit: number,
  enforceKeywordRelevance = true
): WebSearchHit[] {
  const candidates = new Map<string, RankedCandidate>();
  groups.forEach((group) => {
    group.hits.forEach((hit, index) => {
      const key = canonicalUrl(hit.url);
      const score = 1 / (RRF_K + index + 1);
      const existing = candidates.get(key);
      if (!existing) {
        candidates.set(key, {
          hit,
          score,
          providers: new Set([group.provider])
        });
        return;
      }
      existing.score += score;
      existing.providers.add(group.provider);
      existing.hit = richerHit(existing.hit, hit);
    });
  });
  const fused = [...candidates.values()]
    .sort((left, right) => right.score - left.score)
    .map(({ hit, score, providers }) => ({
      ...hit,
      providers: [...providers],
      rankScore: score
    }));
  return (enforceKeywordRelevance ? relevantSearchHits(query, fused) : fused).slice(0, limit);
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm']
      .forEach((key) => url.searchParams.delete(key));
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '');
    return url.toString();
  } catch {
    return value;
  }
}

function richerHit(left: WebSearchHit, right: WebSearchHit): WebSearchHit {
  return {
    ...left,
    title: right.title.length > left.title.length ? right.title : left.title,
    snippet: right.snippet.length > left.snippet.length ? right.snippet : left.snippet,
    ...(left.content || right.content ? { content: left.content || right.content } : {}),
    ...(left.publishedAt || right.publishedAt ? { publishedAt: left.publishedAt || right.publishedAt } : {})
  };
}

interface RankedCandidate {
  hit: WebSearchHit;
  score: number;
  readonly providers: Set<string>;
}
