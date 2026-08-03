import {
  ModelMessageRole,
  questionSetEnrichmentPromptV1,
  type PromptCompiler,
  type ProviderGateway
} from '@/capabilities/ai-runtime/public';
import type { JsonObject, QuestionSetId } from '@/kernel/public';
import {
  TaskCenterStep,
  leaseTokenOf,
  type AgentRunAggregate,
  type InvokeAgentModel,
  type UpdateAgentRunProgress
} from '@/modules/agent/public';
import {
  ContentEnrichmentKind,
  findQuestionSetEnrichmentNeeds,
  hasQuestionSetEnrichmentNeeds,
  parseQuestionSetEnrichment,
  type ApplyQuestionSetEnrichment,
  type CommittedQuestionSetBundle,
  type ContentRepository,
  type ParsedQuestionSetEnrichment,
  type QuestionSetEnrichmentNeeds
} from '@/modules/content/public';
import type {
  ContentEnrichmentStrategy,
  ContentEnrichmentStrategyResult
} from './ContentEnrichmentStrategy';

export interface QuestionSetContentEnrichmentDependencies {
  readonly contentRepository: ContentRepository;
  readonly promptCompiler: PromptCompiler;
  readonly invokeAgentModel: InvokeAgentModel;
  readonly applyEnrichment: ApplyQuestionSetEnrichment;
  readonly updateProgress: UpdateAgentRunProgress;
}

const MAX_PARALLEL_EXPLANATION_REQUESTS = 3;
const MAX_PARALLEL_EXPLANATION_RECOVERY_REQUESTS = 2;
const EXPLANATION_QUESTIONS_PER_REQUEST = 3;

export function createQuestionSetContentEnrichmentStrategy(
  dependencies: QuestionSetContentEnrichmentDependencies
): ContentEnrichmentStrategy {
  return {
    kind: ContentEnrichmentKind.QuestionSet,
    name: 'content.enrich.question_set',
    description: '补全已发布题组缺失的讲义和逐题解析，不修改材料、题干、选项或答案',
    execute: (run, gateway, signal) => executeQuestionSetEnrichment(run, gateway, signal, dependencies)
  };
}

async function executeQuestionSetEnrichment(
  run: AgentRunAggregate,
  gateway: ProviderGateway,
  signal: AbortSignal | undefined,
  dependencies: QuestionSetContentEnrichmentDependencies
): Promise<ContentEnrichmentStrategyResult> {
  const questionSetId = requiredText(
    run.run.targetResourceId || run.run.inputSnapshot.questionSetId,
    'questionSetId'
  ) as QuestionSetId;
  signal?.throwIfAborted();
  let bundle = await requireQuestionSet(dependencies.contentRepository, questionSetId);
  let needs = findQuestionSetEnrichmentNeeds(bundle);
  if (hasQuestionSetEnrichmentNeeds(needs)) {
    await dependencies.updateProgress.execute({
      agentRunId: run.run.id,
      step: TaskCenterStep.PreparingContext,
      progress: 20,
      message: `正在并行补全 ${needs.explanationQuestionIds.length} 道题的解析`,
      leaseToken: leaseTokenOf(run.run)
    });
    const failures: unknown[] = [];
    let commitTail: Promise<void> = Promise.resolve();
    await mapWithConcurrency(
      enrichmentShards(needs),
      MAX_PARALLEL_EXPLANATION_REQUESTS,
      async (shard) => {
        try {
          const enrichment = await requestEnrichmentShard(
            run,
            gateway,
            signal,
            bundle,
            shard,
            dependencies
          );
          const commit = commitTail.then(async () => {
            signal?.throwIfAborted();
            await dependencies.applyEnrichment.execute(questionSetId, enrichment);
          });
          commitTail = commit.catch(() => undefined);
          await commit;
        } catch (error) {
          signal?.throwIfAborted();
          failures.push(error);
        }
      }
    );
    await commitTail;
    signal?.throwIfAborted();
    bundle = await requireQuestionSet(dependencies.contentRepository, questionSetId);
    needs = findQuestionSetEnrichmentNeeds(bundle);
    if (needs.explanationQuestionIds.length) {
      await dependencies.updateProgress.execute({
        agentRunId: run.run.id,
        step: TaskCenterStep.InvokingModel,
        progress: 72,
        message: `正在补齐 ${needs.explanationQuestionIds.length} 道未返回的解析`,
        leaseToken: leaseTokenOf(run.run)
      });
      const recoveryFailures: unknown[] = [];
      await mapWithConcurrency(
        needs.explanationQuestionIds.map((questionId) => ({
          lecture: false,
          explanationQuestionIds: [questionId]
        })),
        MAX_PARALLEL_EXPLANATION_RECOVERY_REQUESTS,
        async (shard) => {
          try {
            const enrichment = await requestEnrichmentShard(
              run,
              gateway,
              signal,
              bundle,
              shard,
              dependencies
            );
            const commit = commitTail.then(async () => {
              signal?.throwIfAborted();
              await dependencies.applyEnrichment.execute(questionSetId, enrichment);
            });
            commitTail = commit.catch(() => undefined);
            await commit;
          } catch (error) {
            signal?.throwIfAborted();
            recoveryFailures.push(error);
          }
        }
      );
      failures.push(...recoveryFailures);
      await commitTail;
      signal?.throwIfAborted();
    }
    await dependencies.updateProgress.execute({
      agentRunId: run.run.id,
      step: TaskCenterStep.CommittingResult,
      progress: 85,
      message: '正在核对已补全的逐题解析',
      leaseToken: leaseTokenOf(run.run)
    });
    bundle = await requireQuestionSet(dependencies.contentRepository, questionSetId);
    needs = findQuestionSetEnrichmentNeeds(bundle);
    if (hasQuestionSetEnrichmentNeeds(needs) && failures.length) {
      throw new ContentEnrichmentIncompleteError(needs, failures.length);
    }
  }
  if (hasQuestionSetEnrichmentNeeds(needs)) {
    throw new ContentEnrichmentIncompleteError(needs);
  }
  return {
    message: '讲义与解析已补全',
    payload: { questionSetId }
  };
}

class ContentEnrichmentIncompleteError extends Error {
  readonly code = 'content.enrichment_incomplete';

  constructor(needs: ReturnType<typeof findQuestionSetEnrichmentNeeds>, failedShards = 0) {
    super(`解析补全未完成：讲义=${needs.lecture ? '缺失' : '完整'}，待补解析=${needs.explanationQuestionIds.length}，失败分片=${failedShards}`);
    this.name = 'ContentEnrichmentIncompleteError';
  }
}

async function requestEnrichmentShard(
  run: AgentRunAggregate,
  gateway: ProviderGateway,
  signal: AbortSignal | undefined,
  bundle: CommittedQuestionSetBundle,
  needs: QuestionSetEnrichmentNeeds,
  dependencies: QuestionSetContentEnrichmentDependencies
): Promise<ParsedQuestionSetEnrichment> {
  const compiled = dependencies.promptCompiler.compile(
    questionSetEnrichmentPromptV1.promptCode,
    {},
    enrichmentPayload(bundle, needs),
    questionSetEnrichmentPromptV1.version
  );
  const response = await dependencies.invokeAgentModel.execute({
    agentRunId: run.run.id,
    leaseToken: leaseTokenOf(run.run),
    modelRole: needs.lecture
      ? 'content_enrichment.question_set.lecture'
      : 'content_enrichment.question_set.explanation',
    system: compiled.system,
    messages: [{ role: ModelMessageRole.User, content: compiled.user }],
    promptVersionId: questionSetEnrichmentPromptV1.versionId,
    responseSchema: compiled.responseSchema,
    temperature: 0.1,
    maxOutputTokens: enrichmentTokenBudget(
      needs.explanationQuestionIds.length,
      needs.lecture
    ),
    preferStream: false
  }, gateway, signal);
  signal?.throwIfAborted();
  return parseQuestionSetEnrichment(response.text, bundle);
}

function enrichmentShards(needs: QuestionSetEnrichmentNeeds): readonly QuestionSetEnrichmentNeeds[] {
  const explanationShards: QuestionSetEnrichmentNeeds[] = [];
  for (
    let offset = 0;
    offset < needs.explanationQuestionIds.length;
    offset += EXPLANATION_QUESTIONS_PER_REQUEST
  ) {
    explanationShards.push({
      lecture: false,
      explanationQuestionIds: needs.explanationQuestionIds.slice(
        offset,
        offset + EXPLANATION_QUESTIONS_PER_REQUEST
      )
    });
  }
  return [
    ...(needs.lecture ? [{ lecture: true, explanationQuestionIds: [] }] : []),
    ...explanationShards
  ];
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  action: (value: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (cursor < values.length) {
        const value = values[cursor];
        cursor += 1;
        if (value !== undefined) await action(value);
      }
    }
  );
  await Promise.all(workers);
}

async function requireQuestionSet(
  repository: ContentRepository,
  questionSetId: QuestionSetId
): Promise<CommittedQuestionSetBundle> {
  const bundle = await repository.findQuestionSet(questionSetId);
  if (!bundle) throw new Error(`Question set does not exist: ${questionSetId}`);
  return bundle;
}

function enrichmentPayload(
  bundle: CommittedQuestionSetBundle,
  needs: ReturnType<typeof findQuestionSetEnrichmentNeeds>
): JsonObject {
  const needed = new Set(needs.explanationQuestionIds);
  const explanationQuestions = bundle.questions
    .filter((question) => needed.has(question.id))
    .map((question) => ({
      questionId: question.id,
      sequence: question.sequence,
      material: question.content.material ?? null,
      prompt: question.content.prompt,
      options: question.content.options.map((option) => ({
        id: option.id,
        content: option.content
      })),
      correctOptionId: question.content.correctOptionId
    }));
  const lectureQuestionSamples = needs.lecture
    ? representativeQuestions(bundle.questions, 8).map((question) => ({
        questionId: question.id,
        sequence: question.sequence,
        material: question.content.material ?? null,
        prompt: question.content.prompt,
        options: question.content.options.map((option) => ({
          id: option.id,
          content: option.content
        })),
        correctOptionId: question.content.correctOptionId
      }))
    : [];
  const context = bundle.generationSpec.contextSnapshot;
  return toJsonObject({
    questionSetId: bundle.questionSet.id,
    learningThreadId: bundle.questionSet.learningThreadId ?? null,
    teachingBlueprintId: bundle.questionSet.teachingBlueprintId ?? null,
    assessmentRole: bundle.questionSet.assessmentRole,
    module: bundle.questionSet.module,
    difficulty: bundle.generationSpec.difficulty,
    capability: context.capability ?? {
      capabilityNodeId: bundle.questionSet.capabilityNodeId
    },
    learningEvidence: context.learningEvidence ?? null,
    teachingPreferences: context.teachingPreferences ?? null,
    missingBlocks: {
      lecture: needs.lecture,
      explanationQuestionIds: needs.explanationQuestionIds
    },
    lectureQuestionSamples,
    explanationQuestions
  });
}

function representativeQuestions<T>(questions: readonly T[], limit: number): readonly T[] {
  const boundedLimit = Math.max(1, Math.floor(limit));
  if (questions.length <= boundedLimit) return questions;
  if (boundedLimit === 1) return [questions[0]!];
  const indexes = new Set(
    Array.from({ length: boundedLimit }, (_, index) => (
      Math.round((index * (questions.length - 1)) / (boundedLimit - 1))
    ))
  );
  return [...indexes].map((index) => questions[index]!);
}

function enrichmentTokenBudget(questionCount: number, includesLecture: boolean): number {
  if (includesLecture) return 4_000;
  return Math.min(3_000, Math.max(1_500, 900 + questionCount * 900));
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Content enrichment input is missing ${field}`);
  }
  return value.trim();
}

function toJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
