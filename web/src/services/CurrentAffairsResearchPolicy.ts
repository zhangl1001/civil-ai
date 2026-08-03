import type { SearchResult } from '@/capabilities/web-research/public';

const AUTHORITY_DOMAIN_WEIGHTS: Readonly<Record<string, number>> = {
  'gov.cn': 10,
  'www.gov.cn': 10,
  'npc.gov.cn': 9,
  'cppcc.gov.cn': 9,
  'court.gov.cn': 9,
  'spp.gov.cn': 9,
  'news.cn': 8,
  'xinhuanet.com': 8,
  'people.com.cn': 8,
  'cctv.com': 7,
  'china.com.cn': 6
};

const CURRENT_AFFAIRS_SIGNALS = [
  '政策', '会议', '改革', '发展', '治理', '民生', '经济', '就业', '教育', '医疗',
  '养老', '科技', '创新', '生态', '法治', '乡村振兴', '区域协调', '公共服务',
  '政府工作', '国务院', '全国人大', '全国政协', '社会热点', '公共安全', '应急',
  '舆情', '外交', '国际形势', '全球治理', '重大工程', '文化发展', '先进典型'
] as const;

const NON_CURRENT_AFFAIRS_SIGNALS = [
  '娱乐', '明星', '综艺', '影视', '游戏', '体育', '赛事', '星座', '穿搭', '美食',
  '旅游攻略', '购物', '彩票', '房价走势'
] as const;

export function buildDailyCurrentAffairsQueries(date: string): readonly string[] {
  return [
    `${date} 中国 国务院 最新政策 重要会议 改革发展`,
    `${date} 新华社 人民日报 时政要闻 国家治理`,
    `${date} 中国 经济民生 法治生态 科技创新 乡村振兴`,
    `${date} 中国 社会热点 公共安全 应急治理 重要事件`,
    `${date} 中国 外交 国际形势 全球治理 重大进展`
  ];
}

export function selectDailyCurrentAffairs(
  resultGroups: readonly (readonly SearchResult[])[],
  limit = 5,
  now = Date.now()
): SearchResult[] {
  const candidates = new Map<string, CurrentAffairsCandidate>();
  resultGroups.forEach((hits) => hits.forEach((hit, rank) => {
    if (!isCurrentAffairsCandidate(hit)) return;
    const key = canonicalUrl(hit.url);
    const existing = candidates.get(key);
    const sourceScore = authorityWeight(hit.domain)
      + topicalSignalCount(`${hit.title} ${hit.snippet} ${hit.content ?? ''}`) * 1.2
      + freshnessScore(hit.publishedAt, now)
      + 2 / (rank + 1);
    if (!existing) {
      candidates.set(key, { hit, score: sourceScore, occurrences: 1 });
      return;
    }
    existing.score += 2 / (rank + 1);
    existing.occurrences += 1;
    existing.hit = richerHit(existing.hit, hit);
  }));
  return [...candidates.values()]
    .map((candidate) => ({
      ...candidate.hit,
      rankScore: candidate.score + Math.max(0, candidate.occurrences - 1) * 2
    }))
    .sort((left, right) => (right.rankScore ?? 0) - (left.rankScore ?? 0))
    .slice(0, Math.max(1, limit));
}

function isCurrentAffairsCandidate(hit: SearchResult): boolean {
  const text = `${hit.title} ${hit.snippet} ${hit.content ?? ''}`;
  const authority = authorityWeight(hit.domain);
  const topicalSignals = topicalSignalCount(text);
  const noiseSignals = countSignals(text, NON_CURRENT_AFFAIRS_SIGNALS);
  if (noiseSignals > 0 && topicalSignals < 2) return false;
  return authority >= 6 || topicalSignals >= 2;
}

function authorityWeight(domain: string): number {
  const normalized = domain.toLocaleLowerCase().replace(/^www\./, '');
  if (normalized.endsWith('.gov.cn')) return 9;
  return AUTHORITY_DOMAIN_WEIGHTS[domain.toLocaleLowerCase()]
    ?? AUTHORITY_DOMAIN_WEIGHTS[normalized]
    ?? 0;
}

function topicalSignalCount(text: string): number {
  return countSignals(text, CURRENT_AFFAIRS_SIGNALS);
}

function countSignals(text: string, signals: readonly string[]): number {
  return signals.reduce((count, signal) => count + (text.includes(signal) ? 1 : 0), 0);
}

function freshnessScore(value: string | undefined, now: number): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  const days = Math.max(0, (now - timestamp) / 86_400_000);
  if (days <= 2) return 3;
  if (days <= 7) return 1.5;
  return 0;
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm']
      .forEach((key) => url.searchParams.delete(key));
    return url.toString();
  } catch {
    return value;
  }
}

function richerHit(left: SearchResult, right: SearchResult): SearchResult {
  return {
    ...left,
    title: right.title.length > left.title.length ? right.title : left.title,
    snippet: right.snippet.length > left.snippet.length ? right.snippet : left.snippet,
    ...(left.content || right.content ? { content: left.content || right.content } : {}),
    ...(left.publishedAt || right.publishedAt ? { publishedAt: left.publishedAt || right.publishedAt } : {}),
    providers: [...new Set([...(left.providers ?? []), ...(right.providers ?? [])])]
  };
}

interface CurrentAffairsCandidate {
  hit: SearchResult;
  score: number;
  occurrences: number;
}
