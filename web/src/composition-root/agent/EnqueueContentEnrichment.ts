import type {
  ExamCycleId,
  AgentRunId,
  JsonObject,
  LearningThreadId
} from '@/kernel/public';
import {
  AgentRunNotificationMode,
  AgentRunType,
  AgentWorkPool,
  TaskTargetType,
  type AgentRunAggregate,
  type CreateAgentRun
} from '@/modules/agent/public';
import {
  ContentEnrichmentKind,
  type ContentEnrichmentKindCode
} from '@/modules/content/public';

export interface EnqueueContentEnrichmentCommand {
  readonly kind: ContentEnrichmentKindCode;
  readonly resourceId: string;
  readonly idempotencyScope: string;
  readonly missingBlocks: readonly string[];
  readonly examCycleId?: ExamCycleId;
  readonly learningThreadId?: LearningThreadId;
  readonly parentAgentRunId?: AgentRunId;
  readonly title?: string;
  readonly detail?: string;
  readonly strategyInput?: JsonObject;
}

/**
 * Reliable internal orchestration for optional generated blocks.
 * Detection is deterministic; only the domain strategy delegates content authoring to AI.
 */
export class EnqueueContentEnrichment {
  constructor(private readonly createAgentRun: CreateAgentRun) {}

  execute(command: EnqueueContentEnrichmentCommand): Promise<AgentRunAggregate> {
    const resourceId = requiredText(command.resourceId, 'resourceId');
    const scope = requiredText(command.idempotencyScope, 'idempotencyScope');
    const missingBlocks = [...new Set(command.missingBlocks.map((block) => block.trim()).filter(Boolean))];
    if (!missingBlocks.length) throw new Error('Content enrichment requires at least one missing block');
    return this.createAgentRun.execute({
      idempotencyKey: `content-enrichment:${command.kind}:${resourceId}:${scope}`,
      runType: AgentRunType.Review,
      parentAgentRunId: command.parentAgentRunId,
      workPool: command.kind === ContentEnrichmentKind.QuestionSet
        ? AgentWorkPool.Assessment
        : AgentWorkPool.Background,
      examCycleId: command.examCycleId,
      learningThreadId: command.learningThreadId,
      targetResourceType: TaskTargetType.ContentEnrichment,
      targetResourceId: resourceId,
      inputSnapshot: {
        ...(command.strategyInput ?? {}),
        enrichmentKind: command.kind,
        resourceId,
        missingBlocks,
        title: command.title ?? '后台补全内容',
        detail: command.detail ?? '内容主体已可使用，系统正在补齐辅助内容',
        taskCenterVisible: false,
        notificationMode: AgentRunNotificationMode.Terminal
      }
    });
  }
}

function requiredText(value: string, field: string): string {
  const parsed = value.trim();
  if (!parsed) throw new Error(`Content enrichment input is missing ${field}`);
  return parsed;
}
