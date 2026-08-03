import type {
  WebPageReadOptions,
  WebPageResponse,
  WebSearchHit,
  WebSearchRequest
} from './WebResearchGateway';

export interface WebSearchProviderAdapter {
  readonly id: string;
  readonly configured: boolean;
  search(request: WebSearchRequest): Promise<readonly WebSearchHit[]>;
}

export interface WebPageProviderAdapter {
  readonly id: string;
  readonly configured: boolean;
  read(
    url: URL,
    signal?: AbortSignal,
    options?: WebPageReadOptions
  ): Promise<WebPageResponse>;
}

export interface RankedProviderResults {
  readonly provider: string;
  readonly hits: readonly WebSearchHit[];
}
