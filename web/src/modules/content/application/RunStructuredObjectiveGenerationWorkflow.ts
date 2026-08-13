import type {
  AIInvocation,
  AIInvocationRepository,
  CompiledPrompt,
  ModelMessage,
  PromptCompiler,
  PromptRepository,
  ProviderGateway,
  ProviderRequest
} from '@/capabilities/ai-runtime/public';
import {
  createProviderExecutionDeadline,
  generationExecutionBudgetMs,
  InvocationValidationStatus,
  ModelMessageRole,
  parseStructuredJson,
  ProviderGatewayError
} from '@/capabilities/ai-runtime/public';
import type { UnitOfWork } from '@/capabilities/database/public';
import {
  type Clock,
  type IdGenerator,
  type JsonObject,
  type JsonValue,
  type WorkflowId
} from '@/kernel/public';
import type { OutboxRepository } from '@/modules/task/public';
import type { ContentRepository, GenerationWorkflowRecord } from '../contracts/ContentRepository';
import type {
  QuestionReferencePackRepository
} from '../contracts/QuestionReferencePackRepository';
import type { QuestionSourceRepository } from '../contracts/QuestionSourceRepository';
import type { GenerationAggregate, GenerationRepository } from '../contracts/GenerationRepository';
import {
  ContentEventType,
  ContentResourceType,
  ContentSchemaCode,
  GenerationWorkflowStatus,
  GenerationWorkflowStep
} from '../domain/ContentCodes';
import { GenerationWorkflowMachine } from '../domain/GenerationWorkflowMachine';
import { GeneratedContentCommitBuilder } from './GeneratedContentCommitBuilder';
import { GeneratedContentParseError, GeneratedContentParser, type GeneratedLectureQuestionSet } from './GeneratedContentParser';
import { GenerationModelInvoker } from './GenerationModelInvoker';
import {
  createPracticeGenerationPlan,
  coreGenerationTokenBudget,
  practiceQuestionAcceptanceRatio,
  practiceCoreResponseSchema,
  practiceCoreSystem,
  shouldGeneratePracticeBlocksInParallel
} from './PracticeCoreGenerationPolicy';
import {
  ShardedObjectiveGenerator,
  type ShardedGenerationProgress
} from './ShardedObjectiveGenerator';
import {
  generationPromptPayload,
  generationPromptVariables
} from './StructuredObjectivePromptContext';
import { StructuredObjectiveContentQualityValidator } from './StructuredObjectiveContentQualityValidator';
import { TrueQuestionStructuralDifferenceValidator } from './TrueQuestionStructuralDifferenceValidator';

export interface GenerationWorkflowResult {
  readonly workflow: GenerationWorkflowRecord;
  readonly questionSetId?: string;
}

export type GenerationWorkflowProgress = ShardedGenerationProgress;

export class RunStructuredObjectiveGenerationWorkflow {
  private readonly machine = new GenerationWorkflowMachine();
  private readonly parser = new GeneratedContentParser();
  private readonly qualityValidator = new StructuredObjectiveContentQualityValidator();
  private readonly differenceValidator = new TrueQuestionStructuralDifferenceValidator();
  private readonly commitBuilder: GeneratedContentCommitBuilder;
  private readonly modelInvoker: GenerationModelInvoker;
  private readonly shardedGenerator: ShardedObjectiveGenerator;

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly generationRepository: GenerationRepository,
    private readonly contentRepository: ContentRepository,
    private readonly promptRepository: PromptRepository,
    private readonly invocationRepository: AIInvocationRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly referencePackRepository: QuestionReferencePackRepository,
    private readonly questionSourceRepository: QuestionSourceRepository,
    private readonly promptCompiler: PromptCompiler,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {
    this.commitBuilder = new GeneratedContentCommitBuilder(clock, ids);
    this.modelInvoker = new GenerationModelInvoker(
      unitOfWork,
      invocationRepository,
      clock,
      ids
    );
    this.shardedGenerator = new ShardedObjectiveGenerator(
      promptCompiler,
      this.modelInvoker,
      (input, expectedCount, expectedCapabilityCode) => (
        this.parseAndValidateObject(input, expectedCount, expectedCapabilityCode)
      )
    );
  }

  async execute(
    workflowId: WorkflowId,
    gateway: ProviderGateway,
    signal?: AbortSignal,
    onProgress?: GenerationWorkflowProgress
  ): Promise<GenerationWorkflowResult> {
    let aggregate = await this.requireAggregate(workflowId);
    if (aggregate.workflow.status === GenerationWorkflowStatus.Committed) {
      const committed = await this.contentRepository.findQuestionSetByGenerationSpec(aggregate.spec.id);
      return { workflow: aggregate.workflow, questionSetId: committed?.questionSet.id };
    }
    if (aggregate.workflow.status === GenerationWorkflowStatus.Failed || aggregate.workflow.status === GenerationWorkflowStatus.Cancelled) {
      return { workflow: aggregate.workflow };
    }
    let invocation: AIInvocation | undefined;
    const deadline = createProviderExecutionDeadline(
      signal,
      generationExecutionBudgetMs(aggregate.spec.requestedCount ?? 0),
      '结构化生题'
    );
    try {
      deadline.signal.throwIfAborted();
      const promptBundle = await this.promptRepository.findById(aggregate.spec.promptVersionId);
      if (!promptBundle) throw new Error(`Prompt version is unavailable: ${aggregate.spec.promptVersionId}`);
      const referencePack = aggregate.spec.referencePackId
        ? await this.referencePackRepository.find(aggregate.spec.referencePackId)
        : undefined;
      if (aggregate.spec.referencePackId && !referencePack) {
        throw new Error(`Question reference pack is unavailable: ${aggregate.spec.referencePackId}`);
      }
      let output: GeneratedLectureQuestionSet;
      if (aggregate.workflow.stagedResult) {
        output = this.parser.parseObject(aggregate.workflow.stagedResult, capabilityCode(aggregate));
      } else {
        await onProgress?.('compiling_prompt', '正在按能力节点组装题目核心结构与质检规则');
        aggregate = await this.advanceToInvocation(aggregate);
        if (aggregate.workflow.currentStep !== GenerationWorkflowStep.InvokeModel) {
          throw new Error(`Generation checkpoint has no staged result at ${aggregate.workflow.currentStep}`);
        }
        const interrupted = await this.pendingInvocation(workflowId);
        const attemptedWorkflow = this.machine.startAttempt(aggregate.workflow, this.clock.now());
        await this.unitOfWork.run(async (context) => {
          if (interrupted) await this.invocationRepository.updateValidation(
            interrupted.id,
            InvocationValidationStatus.Invalid,
            'generation.process_interrupted',
            context
          );
          await this.generationRepository.replaceWorkflow(attemptedWorkflow, aggregate.workflow.version, context);
        });
        aggregate = { spec: aggregate.spec, workflow: attemptedWorkflow };
        const plan = createPracticeGenerationPlan(
          aggregate.spec.requestedCount ?? 0,
          capabilityCode(aggregate)
        );
        output = shouldGeneratePracticeBlocksInParallel(plan)
          ? await this.shardedGenerator.generate({
              aggregate,
              promptBundle,
              referencePack,
              plan,
              gateway,
              signal: deadline.signal,
              onProgress
            })
          : await this.generateSingleCore(
              aggregate,
              this.promptCompiler.compileBundle(
                promptBundle,
                generationPromptVariables(aggregate),
                generationPromptPayload(aggregate, referencePack)
              ),
              gateway,
              deadline.signal,
              onProgress
            );
        deadline.signal.throwIfAborted();
        const parsedWorkflow = this.machine.advance(
          aggregate.workflow,
          GenerationWorkflowStep.ParseStructure,
          this.clock.now(),
          { stagedResult: output.raw }
        );
        await this.unitOfWork.run(async (context) => {
          deadline.signal.throwIfAborted();
          await this.generationRepository.replaceWorkflow(parsedWorkflow, aggregate.workflow.version, context);
        });
        aggregate = { spec: aggregate.spec, workflow: parsedWorkflow };
      }

      const difference = this.differenceValidator.evaluate(output, referencePack);
      output = {
        ...output,
        referenceQuestionIds: difference.referenceQuestionIds
      };
      await onProgress?.('validating_content', '正在校验题量、选项、答案与材料结构');
      deadline.signal.throwIfAborted();
      aggregate = await this.finishValidationSteps(aggregate, output, difference.metrics);
      aggregate = await this.advanceIfAt(aggregate, GenerationWorkflowStep.StageResult, GenerationWorkflowStep.CommitResult);
      aggregate = await this.advanceIfAt(aggregate, GenerationWorkflowStep.CommitResult, GenerationWorkflowStep.PublishOutbox);
      if (aggregate.workflow.currentStep !== GenerationWorkflowStep.PublishOutbox) {
        throw new Error(`Generation cannot commit from step ${aggregate.workflow.currentStep}`);
      }
      const completedWorkflow = this.machine.advance(
        aggregate.workflow,
        GenerationWorkflowStep.Complete,
        this.clock.now()
      );
      const lectureSchema = await this.contentRepository.findPublishedSchema(ContentSchemaCode.Document);
      if (!lectureSchema) throw new Error(`Published content schema is unavailable: ${ContentSchemaCode.Document}`);
      const commit = await this.commitBuilder.build(
        aggregate.spec,
        completedWorkflow,
        lectureSchema.id,
        output,
        referencePack
      );
      const bundle = commit.bundle;
      await onProgress?.('committing_result', '正在保存讲义、题组和学习主线');
      deadline.signal.throwIfAborted();
      await this.unitOfWork.run(async (context) => {
        deadline.signal.throwIfAborted();
        await this.contentRepository.commitQuestionSet(bundle, context);
        await this.questionSourceRepository.saveLineages(commit.lineages, context);
        await this.generationRepository.replaceWorkflow(completedWorkflow, aggregate.workflow.version, context);
        await this.outboxRepository.append({
          id: this.ids.next('OutboxEventId'),
          aggregateType: ContentResourceType.QuestionSet,
          aggregateId: bundle.questionSet.id,
          eventType: ContentEventType.QuestionSetCommitted,
          payload: {
            workflowId: completedWorkflow.id,
            questionSetId: bundle.questionSet.id,
            examCycleId: bundle.questionSet.examCycleId,
            capabilityNodeId: bundle.questionSet.capabilityNodeId
          },
          occurredAt: completedWorkflow.completedAt ?? completedWorkflow.updatedAt,
          attemptCount: 0,
          idempotencyKey: `${completedWorkflow.id}:question-set-committed`
        }, context);
      });
      return { workflow: completedWorkflow, questionSetId: bundle.questionSet.id };
    } catch (error) {
      await this.recordFailure(workflowId, invocation, error, signal?.aborted === true);
      throw error;
    } finally {
      deadline.dispose();
    }
  }

  async cancel(workflowId: WorkflowId): Promise<GenerationWorkflowRecord> {
    const aggregate = await this.requireAggregate(workflowId);
    if (isTerminal(aggregate.workflow)) return aggregate.workflow;
    const cancelled = this.machine.cancel(aggregate.workflow, this.clock.now());
    const pending = await this.pendingInvocations(workflowId);
    await this.unitOfWork.run(async (context) => {
      await this.generationRepository.replaceWorkflow(cancelled, aggregate.workflow.version, context);
      for (const invocation of pending) {
        await this.invocationRepository.updateValidation(
          invocation.id, InvocationValidationStatus.Cancelled, 'generation.cancelled', context
        );
      }
    });
    return cancelled;
  }

  async retry(workflowId: WorkflowId): Promise<GenerationWorkflowRecord> {
    const aggregate = await this.requireAggregate(workflowId);
    const retried = this.machine.retry(aggregate.workflow, this.clock.now());
    await this.unitOfWork.runAutocommit((context) => (
      this.generationRepository.replaceWorkflow(retried, aggregate.workflow.version, context)
    ));
    return retried;
  }

  private async advanceToInvocation(aggregate: GenerationAggregate): Promise<GenerationAggregate> {
    let current = aggregate;
    current = await this.advanceIfAt(current, GenerationWorkflowStep.PrepareContext, GenerationWorkflowStep.CompilePrompt);
    if (current.workflow.currentStep === GenerationWorkflowStep.CompilePrompt) {
      const next = this.machine.advance(
        current.workflow,
        GenerationWorkflowStep.InvokeModel,
        this.clock.now()
      );
      await this.persistWorkflow(current, next);
      current = { spec: current.spec, workflow: next };
    }
    return current;
  }

  private async generateSingleCore(
    aggregate: GenerationAggregate,
    compiled: CompiledPrompt,
    gateway: ProviderGateway,
    signal: AbortSignal,
    onProgress?: GenerationWorkflowProgress
  ): Promise<GeneratedLectureQuestionSet> {
    const expectedCount = aggregate.spec.requestedCount ?? 0;
    const capability = capabilityCode(aggregate);
    const result = await this.generateCompleteCandidate({
      aggregate,
      compiled,
      gateway,
      signal,
      expectedCount,
      system: practiceCoreSystem(compiled.system, capability),
      responseSchema: practiceCoreResponseSchema(compiled.responseSchema, expectedCount, capability),
      role: 'content_generation',
      allowValidSubset: true,
      onProgress
    });
    return result.output;
  }

  private async generateCompleteCandidate(input: {
    readonly aggregate: GenerationAggregate;
    readonly compiled: CompiledPrompt;
    readonly gateway: ProviderGateway;
    readonly signal: AbortSignal;
    readonly expectedCount: number;
    readonly system: string;
    readonly responseSchema: JsonObject;
    readonly role: string;
    readonly allowValidSubset: boolean;
    readonly onProgress?: GenerationWorkflowProgress;
  }): Promise<{ readonly output: GeneratedLectureQuestionSet; readonly text: string }> {
    await input.onProgress?.('invoking_model', 'AI 私教正在生成配套讲义与核心题目');
    const request: Omit<ProviderRequest, 'requestId'> = {
      system: input.system,
      messages: [{ role: ModelMessageRole.User, content: input.compiled.user }],
      temperature: 0.2,
      maxOutputTokens: coreGenerationTokenBudget(
        input.expectedCount,
        capabilityCode(input.aggregate)
      ),
      responseSchema: input.responseSchema,
      // Use the same portable structured protocol as sharded generation.
      // Tool-forced output is inconsistent across Anthropic-compatible APIs.
      structuredOutputMode: 'prompt'
    };
    let invocationResult = await this.modelInvoker.invokeWithRetry(
      input.aggregate,
      input.gateway,
      request,
      input.role,
      input.signal
    );
    await input.onProgress?.('parsing_response', '正在解析讲义、材料、题干、选项与答案');
    try {
      return {
        output: this.parseAndValidateCandidate(
          invocationResult.response.text,
          input.expectedCount,
          capabilityCode(input.aggregate)
        ),
        text: invocationResult.response.text
      };
    } catch (error) {
      if (!(error instanceof GeneratedContentParseError)) throw error;
      const acceptedSubset = input.allowValidSubset
        ? this.tryAcceptValidSubset(
            invocationResult.response.text,
            error,
            input.expectedCount,
            capabilityCode(input.aggregate)
          )
        : undefined;
      if (acceptedSubset) {
        await input.onProgress?.(
          'parsing_response',
          `已保留 ${acceptedSubset.output.questions.length} 道有效题，丢弃 ${acceptedSubset.droppedCount} 道结构异常题`
        );
        return {
          output: acceptedSubset.output,
          text: JSON.stringify(acceptedSubset.output.raw)
        };
      }
      await this.modelInvoker.markInvalid(invocationResult.invocationId, error.code);
      let localizedRepair: LocalizedRepairPlan | undefined;
      try {
        localizedRepair = createLocalizedRepairPlan(
          localizedRepairContext(input.aggregate),
          invocationResult.response.text,
          error,
          input.responseSchema
        );
      } catch {
        localizedRepair = undefined;
      }
      await input.onProgress?.(
        'parsing_response',
        localizedRepair
          ? localizedRepair.progressMessage
          : '结构存在偏差，AI 私教正在重建不完整内容'
      );
      const repairMessages = localizedRepair?.messages
        ?? structuredRepairMessages(input.compiled.user, invocationResult.response.text, error);
      invocationResult = await this.modelInvoker.invokeWithRetry(
        input.aggregate,
        input.gateway,
        {
          system: input.system,
          messages: repairMessages,
          temperature: 0.1,
          maxOutputTokens: localizedRepair?.maxOutputTokens
            ?? coreGenerationTokenBudget(
              input.expectedCount,
              capabilityCode(input.aggregate)
            ),
          responseSchema: localizedRepair?.responseSchema ?? input.responseSchema
        },
        `${input.role}_repair`,
        input.signal
      );
      const repairedText = localizedRepair
        ? localizedRepair.merge(invocationResult.response.text)
        : invocationResult.response.text;
      return {
        output: this.parseAndValidateCandidate(
          repairedText,
          input.expectedCount,
          capabilityCode(input.aggregate)
        ),
        text: repairedText
      };
    }
  }

  private parseAndValidateCandidate(
    text: string,
    expectedCount: number,
    expectedCapabilityCode: string
  ): GeneratedLectureQuestionSet {
    const output = this.parser.parseText(text, expectedCapabilityCode);
    const report = this.qualityValidator.validate(output, expectedCount, expectedCapabilityCode);
    if (!report.valid) {
      throw new GeneratedContentParseError('generation.quality_invalid', report.blockingIssues);
    }
    return output;
  }

  private parseAndValidateObject(
    input: JsonObject,
    expectedCount: number,
    expectedCapabilityCode: string
  ): GeneratedLectureQuestionSet {
    const output = this.parser.parseObject(input, expectedCapabilityCode);
    const report = this.qualityValidator.validate(output, expectedCount, expectedCapabilityCode);
    if (!report.valid) {
      throw new GeneratedContentParseError('generation.quality_invalid', report.blockingIssues);
    }
    return output;
  }

  private tryAcceptValidSubset(
    text: string,
    error: GeneratedContentParseError,
    expectedCount: number,
    expectedCapabilityCode: string
  ): { readonly output: GeneratedLectureQuestionSet; readonly droppedCount: number } | undefined {
    if (
      error.code !== 'generation.author_schema_invalid'
      && error.code !== 'generation.question_schema_invalid'
      && error.code !== 'generation.quality_invalid'
    ) return undefined;
    const invalidIndexes = new Set<number>();
    for (const issue of error.issues) {
      const match = issue.path.match(/^\$\.questions\[(\d+)]/);
      if (!match) return undefined;
      invalidIndexes.add(Number(match[1]));
    }
    if (!invalidIndexes.size) return undefined;
    let root: JsonObject;
    try {
      const parsed = parseStructuredJson(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
      root = parsed as JsonObject;
    } catch {
      return undefined;
    }
    if (!Array.isArray(root.questions)) return undefined;
    const retainedQuestions = root.questions.filter((_, index) => !invalidIndexes.has(index));
    if (
      expectedCount < 1
      || retainedQuestions.length < 1
      || retainedQuestions.length / expectedCount
        < practiceQuestionAcceptanceRatio(expectedCapabilityCode)
    ) return undefined;
    try {
      return {
        output: this.parseAndValidateCandidate(
          JSON.stringify({ ...root, questions: retainedQuestions }),
          expectedCount,
          expectedCapabilityCode
        ),
        droppedCount: root.questions.length - retainedQuestions.length
      };
    } catch {
      return undefined;
    }
  }

  private async finishValidationSteps(
    aggregate: GenerationAggregate,
    output: GeneratedLectureQuestionSet,
    referenceDifference: JsonObject
  ): Promise<GenerationAggregate> {
    let current = await this.advanceIfAt(
      aggregate,
      GenerationWorkflowStep.ParseStructure,
      GenerationWorkflowStep.ValidateSchema
    );
    if (current.workflow.currentStep === GenerationWorkflowStep.ValidateSchema) {
      const report = this.qualityValidator.validate(
        output,
        current.spec.requestedCount ?? 0,
        capabilityCode(current)
      );
      if (!report.valid) {
        const error = new GeneratedContentParseError('generation.quality_invalid', report.blockingIssues);
        throw error;
      }
      const next = this.machine.advance(
        current.workflow,
        GenerationWorkflowStep.ValidateDomain,
        this.clock.now(),
        {
          validation: { schema: 'valid', domain: 'valid', quality: report.metrics, readiness: report.readiness, pendingEnrichment: toJson(report.pendingIssues), trueQuestionDifference: referenceDifference }
        }
      );
      await this.persistWorkflow(current, next);
      current = { spec: current.spec, workflow: next };
    }
    if (current.workflow.currentStep === GenerationWorkflowStep.ValidateDomain) {
      const next = this.machine.advance(current.workflow, GenerationWorkflowStep.QualityReview, this.clock.now());
      const pending = await this.pendingInvocations(current.workflow.id);
      await this.unitOfWork.run(async (context) => {
        await this.generationRepository.replaceWorkflow(next, current.workflow.version, context);
        for (const invocation of pending) {
          await this.invocationRepository.updateValidation(
            invocation.id, InvocationValidationStatus.Valid, undefined, context
          );
        }
      });
      current = { spec: current.spec, workflow: next };
    }
    current = await this.advanceIfAt(current, GenerationWorkflowStep.QualityReview, GenerationWorkflowStep.StageResult);
    return current;
  }

  private async advanceIfAt(
    aggregate: GenerationAggregate,
    currentStep: GenerationWorkflowRecord['currentStep'],
    nextStep: GenerationWorkflowRecord['currentStep']
  ): Promise<GenerationAggregate> {
    if (aggregate.workflow.currentStep !== currentStep) return aggregate;
    const next = this.machine.advance(aggregate.workflow, nextStep, this.clock.now());
    await this.persistWorkflow(aggregate, next);
    return { spec: aggregate.spec, workflow: next };
  }

  private persistWorkflow(aggregate: GenerationAggregate, next: GenerationWorkflowRecord): Promise<void> {
    return this.unitOfWork.runAutocommit((context) => (
      this.generationRepository.replaceWorkflow(next, aggregate.workflow.version, context)
    ));
  }

  private async recordFailure(
    workflowId: WorkflowId,
    invocation: AIInvocation | undefined,
    error: unknown,
    cancelled: boolean
  ): Promise<void> {
    const aggregate = await this.generationRepository.findByWorkflowId(workflowId);
    if (!aggregate || isTerminal(aggregate.workflow)) return;
    const code = errorCode(error, cancelled);
    const terminal = cancelled
      ? this.machine.cancel(aggregate.workflow, this.clock.now())
      : this.machine.fail(aggregate.workflow, code, this.clock.now());
    const pending = invocation ? [] : await this.pendingInvocations(workflowId);
    await this.unitOfWork.run(async (context) => {
      if (invocation) {
        await this.invocationRepository.append({
          ...invocation,
          validationStatus: cancelled ? InvocationValidationStatus.Cancelled : InvocationValidationStatus.Invalid,
          errorCode: code
        }, context);
      } else {
        for (const pendingInvocation of pending) {
          await this.invocationRepository.updateValidation(
            pendingInvocation.id,
            cancelled ? InvocationValidationStatus.Cancelled : InvocationValidationStatus.Invalid,
            code,
            context
          );
        }
      }
      await this.generationRepository.replaceWorkflow(terminal, aggregate.workflow.version, context);
    });
  }

  private async pendingInvocation(workflowId: WorkflowId): Promise<AIInvocation | undefined> {
    return (await this.pendingInvocations(workflowId)).at(-1);
  }

  private async pendingInvocations(workflowId: WorkflowId): Promise<readonly AIInvocation[]> {
    const invocations = await this.invocationRepository.listByWorkflow(workflowId);
    return invocations.filter((item) => item.validationStatus === InvocationValidationStatus.Pending);
  }

  private async requireAggregate(workflowId: WorkflowId): Promise<GenerationAggregate> {
    const aggregate = await this.generationRepository.findByWorkflowId(workflowId);
    if (!aggregate) throw new Error(`Generation workflow does not exist: ${workflowId}`);
    return aggregate;
  }
}

function capabilityCode(aggregate: GenerationAggregate): string {
  const capability = aggregate.spec.contextSnapshot.capability;
  if (!capability || typeof capability !== 'object' || Array.isArray(capability)) {
    throw new TypeError('Generation capability snapshot is invalid');
  }
  const code = (capability as Record<string, unknown>).code;
  if (typeof code !== 'string' || !code.trim()) throw new TypeError('Generation capability code is missing');
  return code.trim();
}

interface LocalizedRepairPlan {
  readonly messages: readonly ModelMessage[];
  readonly responseSchema: JsonObject;
  readonly maxOutputTokens: number;
  readonly progressMessage: string;
  merge(patchText: string): string;
}

function createLocalizedRepairPlan(
  repairContext: JsonObject,
  originalText: string,
  error: GeneratedContentParseError,
  responseSchema: JsonObject
): LocalizedRepairPlan | undefined {
  if (!isLocallyRepairable(error.code) || !error.issues.length) return undefined;
  let questionIndexes = [...new Set(error.issues.flatMap((issue) => {
    const match = issue.path.match(/^\$\.questions\[(\d+)]/);
    return match ? [Number(match[1])] : [];
  }))].sort((left, right) => left - right);
  const repairLecture = error.issues.some((issue) => issue.path.startsWith('$.lecture'));
  const hasQuestionCountMismatch = error.issues.some((issue) => issue.code === 'quality.question_count_mismatch');
  const hasGlobalIssue = error.issues.some((issue) => (
    !issue.path.startsWith('$.lecture')
    && !/^\$\.questions\[\d+]/.test(issue.path)
    && issue.code !== 'quality.question_count_mismatch'
  ));
  if (hasGlobalIssue) return undefined;

  const original = asJsonRecord(parseStructuredJson(originalText));
  const originalQuestions = Array.isArray(original.questions) ? [...original.questions] : undefined;
  const schemaProperties = asJsonRecord(responseSchema.properties);
  const questionArraySchema = asJsonRecord(schemaProperties.questions);
  const questionSchema = questionArraySchema.items;
  const lectureSchema = schemaProperties.lecture;
  if (!originalQuestions || !questionSchema || (repairLecture && !lectureSchema)) return undefined;
  const expectedQuestionCount = repairContext.expectedQuestionCount;
  if (
    hasQuestionCountMismatch
    && typeof expectedQuestionCount === 'number'
    && Number.isInteger(expectedQuestionCount)
    && originalQuestions.length < expectedQuestionCount
  ) {
    questionIndexes = [...new Set([
      ...questionIndexes,
      ...Array.from(
        { length: expectedQuestionCount - originalQuestions.length },
        (_, index) => originalQuestions.length + index
      )
    ])].sort((left, right) => left - right);
  }
  if (!repairLecture && !questionIndexes.length) return undefined;
  if (
    repairLecture
    && typeof expectedQuestionCount === 'number'
    && originalQuestions.length !== expectedQuestionCount
  ) return undefined;
  if (questionIndexes.some((index) => (
    index < 0
    || (
      index >= originalQuestions.length
      && (typeof expectedQuestionCount !== 'number' || index >= expectedQuestionCount)
    )
  ))) return undefined;

  const properties: Record<string, JsonValue> = {};
  const required: JsonValue[] = [];
  if (repairLecture) {
    properties.lecture = lectureSchema;
    required.push('lecture');
  }
  if (questionIndexes.length) {
    properties.questionPatches = {
      type: 'array',
      minItems: questionIndexes.length,
      maxItems: questionIndexes.length,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'question'],
        properties: {
          index: { type: 'integer', enum: questionIndexes },
          question: questionSchema
        }
      }
    };
    required.push('questionPatches');
  }
  const patchSchema: JsonObject = {
    type: 'object',
    additionalProperties: false,
    required,
    properties
  };
  const affectedMaterialGroupIds = new Set(questionIndexes.flatMap((index) => {
    if (index >= originalQuestions.length) return [];
    const question = asJsonRecord(originalQuestions[index]);
    return typeof question.materialGroupId === 'string' && question.materialGroupId
      ? [question.materialGroupId]
      : [];
  }));
  const relevantMaterialGroups = Array.isArray(original.materialGroups)
    ? original.materialGroups.filter((item) => {
      const group = asJsonRecord(item);
      return typeof group.id === 'string' && affectedMaterialGroupIds.has(group.id);
    })
    : [];
  const repairInput = {
    ...(repairLecture ? { lecture: original.lecture } : {}),
    questionPatches: questionIndexes.map((index) => ({
      index,
      mode: index < originalQuestions.length ? 'repair' : 'create',
      question: originalQuestions[index] ?? null
    })),
    existingQuestionSummaries: originalQuestions.map((question, index) => ({
      index,
      id: textField(asJsonRecord(question).id),
      prompt: textField(asJsonRecord(question).prompt)
    })),
    materialGroups: relevantMaterialGroups
  };
  const issues = error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path,
    message: issue.message
  }));
  const messages: readonly ModelMessage[] = [
    {
      role: ModelMessageRole.User,
      content: [
        '请修复下面这次公务员考试内容生成中的指定局部，不得重写其他已通过校验的内容。',
        `本次不可变生成约束：${JSON.stringify(repairContext)}`,
        `局部原文与上下文：${JSON.stringify(repairInput)}`,
        `必须修复的问题：${JSON.stringify(issues)}`,
        '只提交 response schema 要求的 lecture 和/或 questionPatches。',
        'questionPatches 必须保持 index 不变；每个 question 只提交完整材料、题干、选项、答案和必要图形。',
        '不得输出解释、Markdown 代码围栏或未要求的题目。'
      ].join('\n')
    }
  ];
  return {
    messages,
    responseSchema: patchSchema,
    maxOutputTokens: Math.min(8_000, Math.max(
      2_000,
      (repairLecture ? 3_200 : 600) + questionIndexes.length * 1_400
    )),
    progressMessage: repairLecture && questionIndexes.length
      ? `正在定向修复讲义和第 ${questionIndexes.map((index) => index + 1).join('、')} 题`
      : repairLecture
        ? '正在定向补全讲义结构'
        : `正在定向重生成第 ${questionIndexes.map((index) => index + 1).join('、')} 题`,
    merge(patchText: string): string {
      const patch = asJsonRecord(parseStructuredJson(patchText));
      const merged: Record<string, JsonValue> = { ...original };
      if (repairLecture) {
        if (!patch.lecture) throw repairPatchError('$.lecture', 'Repair response is missing lecture');
        merged.lecture = patch.lecture;
      }
      if (questionIndexes.length) {
        if (!Array.isArray(patch.questionPatches)) {
          throw repairPatchError('$.questionPatches', 'Repair response is missing question patches');
        }
        const patchedQuestions = [...originalQuestions] as JsonValue[];
        const seen = new Set<number>();
        patch.questionPatches.forEach((item, patchIndex) => {
          const record = asJsonRecord(item);
          const index = record.index;
          if (
            typeof index !== 'number'
            || !Number.isInteger(index)
            || !questionIndexes.includes(index)
            || seen.has(index)
            || !record.question
          ) {
            throw repairPatchError(
              `$.questionPatches[${patchIndex}]`,
              'Question patch index or content is invalid'
            );
          }
          seen.add(index);
          patchedQuestions[index] = record.question;
        });
        if (seen.size !== questionIndexes.length) {
          throw repairPatchError('$.questionPatches', 'Repair response does not cover every invalid question');
        }
        merged.questions = patchedQuestions;
      }
      return JSON.stringify(merged);
    }
  };
}

function localizedRepairContext(aggregate: GenerationAggregate): JsonObject {
  const capability = aggregate.spec.contextSnapshot.capability;
  const capabilityRecord = capability && typeof capability === 'object' && !Array.isArray(capability)
    ? capability as JsonObject
    : {};
  return {
    expectedQuestionCount: aggregate.spec.requestedCount ?? 0,
    assessmentRole: aggregate.spec.assessmentRole,
    difficulty: aggregate.spec.difficulty,
    capability: {
      code: typeof capabilityRecord.code === 'string' ? capabilityRecord.code : null,
      name: typeof capabilityRecord.name === 'string' ? capabilityRecord.name : null,
      module: typeof capabilityRecord.module === 'string' ? capabilityRecord.module : null
    }
  };
}

function isLocallyRepairable(code: string): boolean {
  return code === 'generation.quality_invalid'
    || code === 'generation.author_schema_invalid'
    || code === 'generation.question_schema_invalid'
    || code === 'generation.lecture_schema_invalid';
}

function repairPatchError(path: string, message: string): GeneratedContentParseError {
  return new GeneratedContentParseError('generation.repair_patch_invalid', [{
    code: 'generation.repair_patch_invalid',
    path,
    message
  }]);
}

function asJsonRecord(value: unknown): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw repairPatchError('$', 'Repair source must be a JSON object');
  }
  return value as Record<string, JsonValue>;
}

function textField(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function structuredRepairMessages(
  originalUserMessage: string,
  invalidOutput: string,
  error: GeneratedContentParseError
) {
  const issues = error.issues.slice(0, 20).map((issue) => ({
    code: issue.code,
    path: issue.path,
    message: issue.message
  }));
  return [
    { role: ModelMessageRole.User, content: originalUserMessage },
    { role: ModelMessageRole.Assistant, content: invalidOutput },
    {
      role: ModelMessageRole.User,
      content: [
        '上一次结构化结果未通过本地严格校验。请只修复结构与缺失内容，不要解释错误。',
        `错误码：${error.code}`,
        `字段问题：${JSON.stringify(issues)}`,
        '重新通过指定工具提交完整 lecture 与 questions 核心结构；不得输出逐题解析、Markdown 代码围栏或解释错误的文字。'
      ].join('\n')
    }
  ] as const;
}

function isTerminal(workflow: GenerationWorkflowRecord): boolean {
  return workflow.status === GenerationWorkflowStatus.Committed
    || workflow.status === GenerationWorkflowStatus.Failed
    || workflow.status === GenerationWorkflowStatus.Cancelled;
}

function errorCode(error: unknown, cancelled: boolean): string {
  if (cancelled) return 'generation.cancelled';
  if (isAbortError(error)) return 'generation.process_interrupted';
  if (error instanceof GeneratedContentParseError) return error.code;
  if (error instanceof ProviderGatewayError) return `provider.${error.kind}`;
  return 'generation.unexpected_failure';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
