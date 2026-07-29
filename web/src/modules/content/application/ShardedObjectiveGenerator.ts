import {
  ModelMessageRole,
  parseStructuredJson,
  type CompiledPrompt,
  type PromptBundle,
  type PromptCompiler,
  type ProviderGateway,
  type ProviderRequest
} from '@/capabilities/ai-runtime/public';
import type { AiInvocationId, JsonObject, JsonValue } from '@/kernel/public';
import type { GenerationAggregate } from '../contracts/GenerationRepository';
import type { TrueQuestionReferencePack } from '../contracts/QuestionReferencePackRepository';
import {
  GeneratedContentParseError,
  type GeneratedLectureQuestionSet
} from './GeneratedContentParser';
import type { GenerationModelInvoker } from './GenerationModelInvoker';
import {
  lectureGenerationTokenBudget,
  practiceLectureResponseSchema,
  practiceLectureSystem,
  practiceQuestionShardResponseSchema,
  practiceQuestionShardSystem,
  questionShardTokenBudget,
  type PracticeGenerationPlan,
  type PracticeGenerationShard
} from './PracticeCoreGenerationPolicy';
import {
  generationPromptPayload,
  generationPromptVariables
} from './StructuredObjectivePromptContext';

export type ShardedGenerationProgress = (
  step: 'compiling_prompt' | 'invoking_model' | 'parsing_response' | 'validating_content' | 'committing_result',
  message: string
) => Promise<void> | void;

interface RawInvocation {
  readonly kind: 'lecture' | 'questions';
  readonly shard?: PracticeGenerationShard;
  readonly user: string;
  readonly responseSchema: JsonObject;
  readonly invocationId: AiInvocationId;
  readonly text: string;
}

export class ShardedObjectiveGenerator {
  constructor(
    private readonly promptCompiler: PromptCompiler,
    private readonly invoker: GenerationModelInvoker,
    private readonly parseAndValidateObject: (
      input: JsonObject,
      expectedCount: number,
      capabilityCode: string
    ) => GeneratedLectureQuestionSet
  ) {}

  async generate(input: {
    readonly aggregate: GenerationAggregate;
    readonly promptBundle: PromptBundle;
    readonly referencePack?: TrueQuestionReferencePack;
    readonly plan: PracticeGenerationPlan;
    readonly gateway: ProviderGateway;
    readonly signal: AbortSignal;
    readonly onProgress?: ShardedGenerationProgress;
  }): Promise<GeneratedLectureQuestionSet> {
    const capability = capabilityCode(input.aggregate);
    const firstShard = input.plan.shards[0];
    if (!firstShard) throw new Error('Generation shard plan is empty');
    await input.onProgress?.(
      'invoking_model',
      `正在以 ${input.plan.shardConcurrency} 路并行生成配套讲义和 ${input.plan.totalCount} 题`
    );
    const contract = teachingContract(input.aggregate, input.plan.totalCount, capability);
    const jobs: readonly (() => Promise<RawInvocation>)[] = [
      () => this.invokeLecture({ ...input, capability, contract }),
      ...input.plan.shards.map((shard) => (
        () => this.invokeShard({ ...input, capability, contract, shard })
      ))
    ];
    let completedJobs = 0;
    const rawInvocations = await mapWithConcurrency(
      jobs,
      input.plan.shardConcurrency,
      async (job) => {
        const result = await job();
        completedJobs += 1;
        await input.onProgress?.(
          'invoking_model',
          `已完成 ${completedJobs}/${jobs.length} 个并行生成请求`
        );
        return result;
      }
    );
    const lectureInvocation = rawInvocations.find((item) => item.kind === 'lecture');
    if (!lectureInvocation) throw new Error('Lecture generation invocation is missing');
    const lectureRoot = await this.parseLectureOrRepair(
      lectureInvocation,
      input,
      capability
    );
    const questionRoots = await mapWithConcurrency(
      rawInvocations.filter((item) => item.kind === 'questions'),
      input.plan.shardConcurrency,
      (item) => this.parseShardOrRepair(item, input, capability, lectureRoot.lecture)
    );
    const output = this.parseAndValidateObject(
      mergeAuthorRoots([
        {
          lecture: lectureRoot.lecture,
          materialGroups: [],
          questions: []
        },
        ...questionRoots
      ]),
      input.plan.totalCount,
      capability
    );
    await input.onProgress?.(
      'parsing_response',
      `已按原顺序合并讲义和 ${input.plan.shards.length} 个题目分片，共 ${output.questions.length} 题`
    );
    return output;
  }

  private compile(
    aggregate: GenerationAggregate,
    promptBundle: PromptBundle,
    referencePack: TrueQuestionReferencePack | undefined,
    shard: PracticeGenerationShard,
    totalCount: number
  ): CompiledPrompt {
    return this.promptCompiler.compile(
      promptBundle.promptCode,
      generationPromptVariables(aggregate, shard.count),
      generationPromptPayload(aggregate, referencePack, shard, totalCount),
      promptBundle.version
    );
  }

  private async invokeLecture(input: {
    readonly aggregate: GenerationAggregate;
    readonly promptBundle: PromptBundle;
    readonly referencePack?: TrueQuestionReferencePack;
    readonly plan: PracticeGenerationPlan;
    readonly gateway: ProviderGateway;
    readonly signal: AbortSignal;
    readonly capability: string;
    readonly contract: JsonObject;
  }): Promise<RawInvocation> {
    const compiled = this.compile(
      input.aggregate,
      input.promptBundle,
      input.referencePack,
      { index: 0, offset: 0, count: 1 },
      input.plan.totalCount
    );
    const system = practiceLectureSystem(compiled.system, input.capability);
    const responseSchema = practiceLectureResponseSchema(compiled.responseSchema);
    const user = lectureUserMessage(compiled.user, input.contract);
    const request: Omit<ProviderRequest, 'requestId'> = {
      system,
      messages: [{ role: ModelMessageRole.User, content: user }],
      temperature: 0.2,
      maxOutputTokens: lectureGenerationTokenBudget(input.capability),
      responseSchema
    };
    const invocation = await this.invoker.invoke(
      input.aggregate,
      input.gateway,
      request,
      'content_generation_lecture',
      input.signal
    );
    return {
      kind: 'lecture',
      user,
      responseSchema,
      invocationId: invocation.invocationId,
      text: invocation.response.text
    };
  }

  private async invokeShard(input: {
    readonly aggregate: GenerationAggregate;
    readonly promptBundle: PromptBundle;
    readonly referencePack?: TrueQuestionReferencePack;
    readonly plan: PracticeGenerationPlan;
    readonly shard: PracticeGenerationShard;
    readonly gateway: ProviderGateway;
    readonly signal: AbortSignal;
    readonly capability: string;
    readonly contract: JsonObject;
  }): Promise<RawInvocation> {
    const compiled = this.compile(
      input.aggregate,
      input.promptBundle,
      input.referencePack,
      input.shard,
      input.plan.totalCount
    );
    const system = practiceQuestionShardSystem(compiled.system, input.capability);
    const responseSchema = practiceQuestionShardResponseSchema(
      compiled.responseSchema,
      input.shard.count
    );
    const user = shardUserMessage(compiled.user, input);
    const invocation = await this.invoker.invoke(
      input.aggregate,
      input.gateway,
      {
        system,
        messages: [{ role: ModelMessageRole.User, content: user }],
        temperature: 0.2,
        maxOutputTokens: questionShardTokenBudget(input.shard.count, input.capability),
        responseSchema
      },
      'content_generation_question_shard',
      input.signal
    );
    return {
      kind: 'questions',
      shard: input.shard,
      user,
      responseSchema,
      invocationId: invocation.invocationId,
      text: invocation.response.text
    };
  }

  private async parseLectureOrRepair(
    invocation: RawInvocation,
    input: {
      readonly aggregate: GenerationAggregate;
      readonly gateway: ProviderGateway;
      readonly signal: AbortSignal;
    },
    capability: string
  ): Promise<JsonObject> {
    try {
      const root = parseAuthorRoot(invocation.text);
      if (!root.lecture) throw new GeneratedContentParseError('generation.lecture_schema_invalid', [{
        code: 'generation.lecture_schema_invalid',
        path: '$.lecture',
        message: 'Lecture response must contain lecture'
      }]);
      return root;
    } catch (error) {
      if (!(error instanceof GeneratedContentParseError)) throw error;
      await this.invoker.markInvalid(invocation.invocationId, error.code);
      const repaired = await this.invoker.invoke(
        input.aggregate,
        input.gateway,
        {
          system: practiceLectureSystem('请修复当前讲义结构，不要输出题目。', capability),
          messages: [
            { role: ModelMessageRole.User, content: invocation.user },
            { role: ModelMessageRole.Assistant, content: invocation.text },
            { role: ModelMessageRole.User, content: `只返回合法 lecture。错误：${JSON.stringify(error.issues.slice(0, 12))}` }
          ],
          temperature: 0.1,
          maxOutputTokens: lectureGenerationTokenBudget(capability),
          responseSchema: invocation.responseSchema
        },
        'content_generation_lecture_repair',
        input.signal
      );
      return parseAuthorRoot(repaired.response.text);
    }
  }

  private async parseShardOrRepair(
    invocation: RawInvocation,
    input: {
      readonly aggregate: GenerationAggregate;
      readonly gateway: ProviderGateway;
      readonly signal: AbortSignal;
    },
    capability: string,
    lecture: JsonValue
  ): Promise<JsonObject> {
    const shard = invocation.shard!;
    try {
      const root = namespaceAuthorRoot(parseAuthorRoot(invocation.text), shard.index);
      if (!Array.isArray(root.questions) || root.questions.length !== shard.count) {
        throw new GeneratedContentParseError('generation.question_shard_invalid', [{
          code: 'generation.question_shard_invalid',
          path: '$.questions',
          message: `Question shard must contain exactly ${shard.count} questions`
        }]);
      }
      this.parseAndValidateObject({
        lecture,
        materialGroups: Array.isArray(root.materialGroups) ? root.materialGroups : [],
        questions: root.questions
      }, shard.count, capability);
      return root;
    } catch (error) {
      if (!(error instanceof GeneratedContentParseError)) throw error;
      await this.invoker.markInvalid(invocation.invocationId, error.code);
      const repaired = await this.invoker.invoke(
        input.aggregate,
        input.gateway,
        {
          system: practiceQuestionShardSystem('请修复当前题目分片结构。', capability),
          messages: [
            { role: ModelMessageRole.User, content: invocation.user },
            { role: ModelMessageRole.Assistant, content: invocation.text },
            { role: ModelMessageRole.User, content: `只返回当前分片的合法 questions 和 materialGroups。错误：${JSON.stringify(error.issues.slice(0, 12))}` }
          ],
          temperature: 0.1,
          maxOutputTokens: questionShardTokenBudget(shard.count, capability),
          responseSchema: invocation.responseSchema
        },
        'content_generation_question_shard_repair',
        input.signal
      );
      const root = namespaceAuthorRoot(parseAuthorRoot(repaired.response.text), shard.index);
      this.parseAndValidateObject({
        lecture,
        materialGroups: Array.isArray(root.materialGroups) ? root.materialGroups : [],
        questions: Array.isArray(root.questions) ? root.questions : []
      }, shard.count, capability);
      return root;
    }
  }
}

function shardUserMessage(
  compiledUser: string,
  input: {
    readonly plan: PracticeGenerationPlan;
    readonly shard: PracticeGenerationShard;
    readonly contract: JsonObject;
  }
): string {
  return [
    compiledUser,
    '',
    '# 不可变教学契约',
    JSON.stringify(input.contract),
    '',
    '# 当前分片',
    JSON.stringify({
      totalQuestionCount: input.plan.totalCount,
      shardIndex: input.shard.index,
      globalQuestionNumbers: [
        input.shard.offset + 1,
        input.shard.offset + input.shard.count
      ],
      requestedCount: input.shard.count,
      variationFocus: shardVariationFocus(input.shard.index),
    }),
    '只提交当前分片的 questions 和必要的 materialGroups。'
  ].join('\n');
}

function lectureUserMessage(compiledUser: string, contract: JsonObject): string {
  return [
    compiledUser,
    '',
    '# 不可变教学契约',
    JSON.stringify(contract),
    '只提交 lecture，不要输出 questions 或 materialGroups。'
  ].join('\n');
}

function teachingContract(
  aggregate: GenerationAggregate,
  totalCount: number,
  capabilityCode: string
): JsonObject {
  const context = aggregate.spec.contextSnapshot;
  const capability = context.capability;
  return {
    capabilityCode,
    capability: isObject(capability)
      ? compactObject({
          code: text(capability.code) ?? capabilityCode,
          name: text(capability.name),
          module: text(capability.module)
        })
      : { code: capabilityCode },
    assessmentRole: aggregate.spec.assessmentRole,
    difficulty: aggregate.spec.difficulty,
    constraints: aggregate.spec.constraints,
    totalQuestionCount: totalCount,
    pairingRule: 'lecture and every question shard must teach and test the same capability node'
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function compactObject(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as JsonObject;
}

function parseAuthorRoot(text: string): JsonObject {
  let parsed: JsonValue;
  try {
    parsed = parseStructuredJson(text);
  } catch {
    throw rootError('generation.json_invalid', 'Provider output must be one valid JSON object');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw rootError('generation.root_invalid', 'Generated result must be an object');
  }
  return parsed;
}

function rootError(code: string, message: string): GeneratedContentParseError {
  return new GeneratedContentParseError(code, [{ code, path: '$', message }]);
}

function namespaceAuthorRoot(root: JsonObject, shardIndex: number): JsonObject {
  const cloned = JSON.parse(JSON.stringify(root)) as JsonObject;
  const idMap = new Map<string, string>();
  const materialGroups = Array.isArray(cloned.materialGroups)
    ? cloned.materialGroups.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        const id = typeof item.id === 'string' ? item.id : undefined;
        if (!id) return item;
        const namespacedId = `shard-${shardIndex + 1}:${id}`;
        idMap.set(id, namespacedId);
        return { ...item, id: namespacedId };
      })
    : [];
  const questions = Array.isArray(cloned.questions)
    ? cloned.questions.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        const materialGroupId = typeof item.materialGroupId === 'string'
          ? item.materialGroupId
          : undefined;
        return materialGroupId && idMap.has(materialGroupId)
          ? { ...item, materialGroupId: idMap.get(materialGroupId)! }
          : item;
      })
    : [];
  return { ...cloned, materialGroups, questions };
}

function mergeAuthorRoots(roots: readonly JsonObject[]): JsonObject {
  const first = roots[0];
  if (!first) throw new Error('Cannot merge an empty generation result');
  return {
    ...first,
    materialGroups: roots.flatMap((root) => (
      Array.isArray(root.materialGroups) ? root.materialGroups : []
    )),
    questions: roots.flatMap((root) => (
      Array.isArray(root.questions) ? root.questions : []
    ))
  };
}

function shardVariationFocus(index: number): string {
  return [
    '基础识别与核心方法',
    '概念边界与典型干扰项',
    '真实场景应用与方法选择',
    '相邻知识迁移与变式辨析',
    '综合应用与限时决策'
  ][index % 5]!;
}

function capabilityCode(aggregate: GenerationAggregate): string {
  const capability = aggregate.spec.contextSnapshot.capability;
  if (!capability || typeof capability !== 'object' || Array.isArray(capability)) {
    throw new TypeError('Generation capability snapshot is invalid');
  }
  const code = (capability as Record<string, unknown>).code;
  if (typeof code !== 'string' || !code.trim()) {
    throw new TypeError('Generation capability code is missing');
  }
  return code.trim();
}

async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  worker: (item: Input, index: number) => Promise<Output>
): Promise<readonly Output[]> {
  if (!items.length) return [];
  const results = new Array<Output>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, Math.floor(concurrency)), items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]!, index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}
