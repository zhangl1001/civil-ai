export const WebSearchFreshness = {
  Day: 'day',
  Week: 'week',
  Month: 'month',
  Year: 'year',
  Any: 'any'
} as const;
export type WebSearchFreshness = typeof WebSearchFreshness[keyof typeof WebSearchFreshness];

export interface WebSearchRequest {
  readonly query: string;
  readonly freshness: WebSearchFreshness;
  readonly limit: number;
  readonly signal?: AbortSignal;
}

export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly domain: string;
  readonly snippet: string;
  readonly content?: string;
  readonly publishedAt?: string;
  readonly providers?: readonly string[];
  readonly rankScore?: number;
}

export type WebSearchHit = SearchResult;

export interface WebSearchResponse {
  readonly query: string;
  readonly hits: readonly WebSearchHit[];
  readonly fetchedAt: number;
}

export interface WebDocument {
  readonly title: string;
  readonly url: string;
  readonly domain: string;
  readonly content: string;
  readonly fetchedAt: number;
  readonly provider?: string;
}

export type WebPageResponse = WebDocument;

export interface WebPageReadOptions {
  readonly focus?: string;
  readonly offset?: number;
}

export interface WebResearchGateway {
  search(request: WebSearchRequest): Promise<WebSearchResponse>;
  readPage(url: string, signal?: AbortSignal, options?: WebPageReadOptions): Promise<WebPageResponse>;
}
