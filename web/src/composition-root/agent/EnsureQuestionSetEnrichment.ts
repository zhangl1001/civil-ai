import type { QuestionSetId } from '@/kernel/public';
import {
  AgentRunStatus,
  TaskTargetType,
  type AgentRunRepository
} from '@/modules/agent/public';
import {
  ContentEnrichmentKind,
  findQuestionSetEnrichmentNeeds,
  hasQuestionSetEnrichmentNeeds,
  type ContentRepository,
  type QuestionSetEnrichmentNeeds
} from '@/modules/content/public';
import { EnqueueContentEnrichment } from './EnqueueContentEnrichment';

export interface EnsureQuestionSetEnrichmentCommand {
  readonly questionSetId: string;
  readonly parentAgentRunId?: string;
  readonly title?: string;
  readonly detail?: string;
}

export interface EnsureQuestionSetEnrichmentResult {
  readonly complete: boolean;
  readonly needs: QuestionSetEnrichmentNeeds;
  readonly agentRunId?: string;
}

/**
 * One idempotent entry point for every question-set enrichment trigger.
 * Page entry, generation completion and submission may all call it safely.
 */
export class EnsureQuestionSetEnrichment {
  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly agentRunRepository: AgentRunRepository,
    private readonly enqueue: EnqueueContentEnrichment
  ) {}

  async execute(
    command: EnsureQuestionSetEnrichmentCommand
  ): Promise<EnsureQuestionSetEnrichmentResult> {
    const questionSetId = requiredQuestionSetId(command.questionSetId);
    const bundle = await this.contentRepository.findQuestionSet(questionSetId);
    if (!bundle) throw new Error(`Question set does not exist: ${questionSetId}`);
    const needs = findQuestionSetEnrichmentNeeds(bundle);
    if (!hasQuestionSetEnrichmentNeeds(needs)) return { complete: true, needs };

    const targetType = TaskTargetType.ContentEnrichment;
    const active = await this.agentRunRepository.findActiveByTarget(
      targetType,
      questionSetId
    );
    if (active) {
      return { complete: false, needs, agentRunId: active.run.id };
    }

    const latest = await this.agentRunRepository.findLatestByTarget(
      targetType,
      questionSetId
    );
    const blocks = [
      ...(needs.lecture ? ['lecture'] : []),
      ...(needs.explanationQuestionIds.length ? ['explanation'] : [])
    ];
    const previousAttempt = latest
      ? `${latest.run.id}:${latest.run.version}:${latest.run.status}`
      : 'initial';
    const run = await this.enqueue.execute({
      kind: ContentEnrichmentKind.QuestionSet,
      resourceId: questionSetId,
      idempotencyScope: [
        `content-v${bundle.questionSet.contentVersion}`,
        blocks.join('+'),
        previousAttempt
      ].join(':'),
      missingBlocks: blocks,
      examCycleId: bundle.questionSet.examCycleId,
      learningThreadId: bundle.questionSet.learningThreadId,
      parentAgentRunId: command.parentAgentRunId,
      title: command.title ?? enrichmentTitle(needs),
      detail: command.detail ?? enrichmentDetail(needs),
      strategyInput: {
        questionSetId,
        questionSetContentVersion: bundle.questionSet.contentVersion
      }
    });
    return {
      complete: run.run.status === AgentRunStatus.Completed,
      needs,
      agentRunId: run.run.id
    };
  }
}

function requiredQuestionSetId(value: string): QuestionSetId {
  const parsed = value.trim();
  if (!parsed) throw new Error('Question-set enrichment requires questionSetId');
  return parsed as QuestionSetId;
}

function enrichmentTitle(needs: QuestionSetEnrichmentNeeds): string {
  return needs.lecture ? '修复讲义与解析' : '补全逐题解析';
}

function enrichmentDetail(needs: QuestionSetEnrichmentNeeds): string {
  return needs.lecture
    ? '正在修复旧题组缺失的配套讲义，并补齐逐题解析'
    : '题组已经可以作答，正在后台补齐逐题解析';
}
