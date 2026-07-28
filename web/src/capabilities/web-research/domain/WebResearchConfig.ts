export const WebSearchProvider = {
  BuiltIn: 'built_in',
  Jina: 'jina',
  Brave: 'brave'
} as const;
export type WebSearchProvider = typeof WebSearchProvider[keyof typeof WebSearchProvider];

export interface WebResearchConfig {
  readonly enabled: boolean;
  readonly provider: WebSearchProvider;
  readonly apiKey: string;
  readonly updatedAt: number;
}
