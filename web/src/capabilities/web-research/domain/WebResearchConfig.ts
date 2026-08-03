export const WebSearchProvider = {
  Auto: 'auto',
  BuiltIn: 'built_in',
  Jina: 'jina',
  Brave: 'brave',
  Firecrawl: 'firecrawl',
  SearXNG: 'searxng'
} as const;
export type WebSearchProvider = typeof WebSearchProvider[keyof typeof WebSearchProvider];

export interface WebResearchConfig {
  readonly enabled: boolean;
  readonly provider: WebSearchProvider;
  readonly apiKey: string;
  readonly jinaApiKey?: string;
  readonly braveApiKey?: string;
  readonly firecrawlApiKey?: string;
  readonly firecrawlBaseUrl?: string;
  readonly searxngBaseUrl?: string;
  readonly updatedAt: number;
}
