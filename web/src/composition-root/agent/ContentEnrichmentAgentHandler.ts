import type { ProviderGateway } from '@/capabilities/ai-runtime/public';
import {
  AgentRunAction,
  TaskCenterStep,
  TaskTargetType,
  leaseTokenOf,
  type AgentRunAggregate,
  type TransitionAgentRun
} from '@/modules/agent/public';
import {
  ContentEnrichmentKind,
  type ContentEnrichmentKindCode
} from '@/modules/content/public';
import type { ContentEnrichmentStrategyRegistry } from './ContentEnrichmentStrategy';

export interface ContentEnrichmentAgentDependencies {
  readonly strategies: ContentEnrichmentStrategyRegistry;
  readonly transition: TransitionAgentRun;
}

export async function executeContentEnrichment(
  run: AgentRunAggregate,
  gateway: ProviderGateway | undefined,
  signal: AbortSignal | undefined,
  dependencies: ContentEnrichmentAgentDependencies
): Promise<void> {
  if (!gateway) throw new Error('Content enrichment requires provider gateway');
  if (run.run.targetResourceType !== TaskTargetType.ContentEnrichment) {
    throw new Error(`Unsupported content enrichment target: ${run.run.targetResourceType || 'unknown'}`);
  }
  const kind = enrichmentKind(run.run.inputSnapshot.enrichmentKind);
  const result = await dependencies.strategies.resolve(kind).execute(run, gateway, signal);
  await dependencies.transition.execute({
    idempotencyKey: `agent-run:${run.run.id}:completed`,
    agentRunId: run.run.id,
    action: AgentRunAction.Complete,
    reasonCode: `content_enrichment.${kind}.completed`,
    checkpoint: {
      ...run.run.checkpoint,
      step: TaskCenterStep.Completed,
      progress: 100,
      message: result.message,
      ...result.payload,
      // Enrichment is silent while running. The parent run becomes visible
      // only once all shards have committed and the final result is known.
      taskCenterVisible: true
    },
    payload: result.payload,
    leaseToken: leaseTokenOf(run.run)
  });
}

function enrichmentKind(value: unknown): ContentEnrichmentKindCode {
  if (!Object.values(ContentEnrichmentKind).includes(value as ContentEnrichmentKindCode)) {
    throw new Error(`Content enrichment kind is invalid: ${String(value || 'missing')}`);
  }
  return value as ContentEnrichmentKindCode;
}
