export {
  WebSearchFreshness,
  type WebPageReadOptions,
  type WebPageResponse,
  type WebResearchGateway,
  type WebSearchFreshness as WebSearchFreshnessCode,
  type WebSearchHit,
  type WebSearchRequest,
  type WebSearchResponse
} from './contracts/WebResearchGateway';
export {
  WebSearchProvider,
  type WebResearchConfig,
  type WebSearchProvider as WebSearchProviderCode
} from './domain/WebResearchConfig';
export { requirePublicWebUrl } from './domain/WebUrlPolicy';
export { ConfiguredWebResearchGateway } from './adapters/ConfiguredWebResearchGateway';
