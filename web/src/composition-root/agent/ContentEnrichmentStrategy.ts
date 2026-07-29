import type { ProviderGateway } from '@/capabilities/ai-runtime/public';
import type { JsonObject } from '@/kernel/public';
import type { AgentRunAggregate } from '@/modules/agent/public';
import type { ContentEnrichmentKindCode } from '@/modules/content/public';

export interface ContentEnrichmentStrategyResult {
  readonly message: string;
  readonly payload: JsonObject;
}

export interface ContentEnrichmentStrategy {
  readonly kind: ContentEnrichmentKindCode;
  readonly name: string;
  readonly description: string;
  execute(
    run: AgentRunAggregate,
    gateway: ProviderGateway,
    signal?: AbortSignal
  ): Promise<ContentEnrichmentStrategyResult>;
}

export class ContentEnrichmentStrategyRegistry {
  private readonly strategies = new Map<ContentEnrichmentKindCode, ContentEnrichmentStrategy>();

  constructor(strategies: readonly ContentEnrichmentStrategy[] = []) {
    strategies.forEach((strategy) => this.register(strategy));
  }

  register(strategy: ContentEnrichmentStrategy): void {
    if (this.strategies.has(strategy.kind)) {
      throw new Error(`Content enrichment strategy is already registered: ${strategy.kind}`);
    }
    this.strategies.set(strategy.kind, strategy);
  }

  resolve(kind: ContentEnrichmentKindCode): ContentEnrichmentStrategy {
    const strategy = this.strategies.get(kind);
    if (!strategy) throw new Error(`Content enrichment strategy is unavailable: ${kind}`);
    return strategy;
  }

  manifests(): readonly Pick<ContentEnrichmentStrategy, 'kind' | 'name' | 'description'>[] {
    return [...this.strategies.values()].map(({ kind, name, description }) => ({
      kind,
      name,
      description
    }));
  }
}
