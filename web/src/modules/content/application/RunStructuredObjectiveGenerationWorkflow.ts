import type {
  AIInvocation,
  AIInvocationRepository,
  ModelMessage,
  PromptCompiler,
  PromptRepository,
  ProviderGateway
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
  sha256Json,
  type Clock,
  type IdGenerator,
  type JsonObject,
  type JsonValue,
  type WorkflowId
} from '@/kernel/public';
import type { OutboxRepository } from '@/modules/task/public';
import type { ContentRepository, GenerationWorkflowRecord } from '../contracts/ContentRepository';
import type {
  QuestionReferencePackRepository,
  TrueQuestionReferencePack
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
import { StructuredObjectiveContentQualityValidator } from './StructuredObjectiveContentQualityValidator';
import { TrueQuestionStructuralDifferenceValidator } from './TrueQuestionStructuralDifferenceValidator';

export interface GenerationWorkflowResult {
  readonly workflow: GenerationWorkflowRecord;
  readonly questionSetId?: string;
}

export type GenerationWorkflowProgress = (
  step: 'compiling_prompt' | 'invoking_model' | 'parsing_response' | 'validating_content' | 'committing_result',
  message: string
) => Promise<void> | void;

export class RunStructuredObjectiveGenerationWorkflow {
  private readonly machine = new GenerationWorkflowMachine();
  private readonly parser = new GeneratedContentParser();
  private readonly qualityValidator = new StructuredObjectiveContentQualityValidator();
  private readonly differenceValidator = new TrueQuestionStructuralDifferenceValidator();
  private readonly commitBuilder: GeneratedContentCommitBuilder;

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
        this.assertStructuralDifference(output, referencePack);
      } else {
        await onProgress?.('compiling_prompt', '正在按能力节点组装讲义、题目与质检规则');
        aggregate = await this.advanceToInvocation(aggregate);
        if (aggregate.workflow.currentStep !== GenerationWorkflowStep.InvokeModel) {
          throw new Error(`Generation checkpoint has no staged result at ${aggregate.workflow.currentStep}`);
        }
        const compiled = this.promptCompiler.compile(
          promptBundle.promptCode,
          promptVariables(aggregate),
          generationPayload(aggregate, referencePack),
          promptBundle.version
        );
        const invocationId = this.ids.next('AiInvocationId');
        const requestHash = await sha256Json(toJson({
          provider: gateway.provider,
          model: gateway.model,
          system: compiled.system,
          user: compiled.user,
          responseSchema: compiled.responseSchema
        }));
        const started = Number(this.clock.monotonicNowMs());
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
        invocation = {
          id: invocationId,
          workflowId,
          provider: gateway.provider,
          model: gateway.model,
          modelRole: 'content_generation',
          promptVersionId: aggregate.spec.promptVersionId,
          contentSchemaVersionId: aggregate.spec.contentSchemaVersionId,
          requestHash,
          validationStatus: InvocationValidationStatus.Pending,
          createdAt: this.clock.now()
        };
        await this.unitOfWork.runAutocommit((context) => this.invocationRepository.append(invocation!, context));
        invocation = undefined;
        await onProgress?.('invoking_model', 'AI 私教正在生成讲义和配套题目');
        let response = await gateway.complete({
          system: compiled.system,
          messages: [{ role: ModelMessageRole.User, content: compiled.user }],
          temperature: 0.2,
          maxOutputTokens: generationTokenBudget(aggregate.spec.requestedCount ?? 0),
          responseSchema: compiled.responseSchema,
          requestId: invocationId
        }, deadline.signal);
        const invocationResult = {
          providerRequestId: response.providerRequestId,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          latencyMs: Math.max(0, Number(this.clock.monotonicNowMs()) - started),
          finishReason: response.finishReason
        };
        await this.unitOfWork.runAutocommit((context) => this.invocationRepository.updateResult(invocationId, invocationResult, context));
        await onProgress?.('parsing_response', '正在解析题干、选项、答案与讲义结构');
        try {
          output = this.parseAndValidateCandidate(
            response.text,
            aggregate.spec.requestedCount ?? 0,
            capabilityCode(aggregate),
            referencePack
          );
        } catch (error) {
          if (!(error instanceof GeneratedContentParseError)) throw error;
          const acceptedSubset = this.tryAcceptValidSubset(
            response.text,
            error,
            aggregate.spec.requestedCount ?? 0,
            capabilityCode(aggregate),
            referencePack
          );
          if (acceptedSubset) {
            output = acceptedSubset.output;
            await onProgress?.(
              'parsing_response',
              `已保留 ${output.questions.length} 道有效题，丢弃 ${acceptedSubset.droppedCount} 道结构异常题`
            );
          } else {
            await this.unitOfWork.runAutocommit((context) => this.invocationRepository.updateValidation(
              invocationId,
              InvocationValidationStatus.Invalid,
              error.code,
              context
            ));
            let localizedRepair: LocalizedRepairPlan | undefined;
            try {
              localizedRepair = createLocalizedRepairPlan(
                localizedRepairContext(aggregate),
                response.text,
                error,
                compiled.responseSchema
              );
            } catch {
              localizedRepair = undefined;
            }
            await onProgress?.(
              'parsing_response',
              localizedRepair
                ? localizedRepair.progressMessage
                : '结构存在偏差，AI 私教正在重建不完整内容'
            );
            const repairInvocationId = this.ids.next('AiInvocationId');
            const repairMessages = localizedRepair?.messages
              ?? structuredRepairMessages(compiled.user, response.text, error);
            const repairResponseSchema = localizedRepair?.responseSchema ?? compiled.responseSchema;
            const repairRequestHash = await sha256Json(toJson({
              provider: gateway.provider,
              model: gateway.model,
              system: compiled.system,
              messages: repairMessages,
              responseSchema: repairResponseSchema,
              repairOf: invocationId
            }));
            const repairInvocation: AIInvocation = {
              id: repairInvocationId,
              workflowId,
              provider: gateway.provider,
              model: gateway.model,
              modelRole: 'content_generation_repair',
              promptVersionId: aggregate.spec.promptVersionId,
              contentSchemaVersionId: aggregate.spec.contentSchemaVersionId,
              requestHash: repairRequestHash,
              validationStatus: InvocationValidationStatus.Pending,
              createdAt: this.clock.now()
            };
            await this.unitOfWork.runAutocommit((context) => this.invocationRepository.append(repairInvocation, context));
            const repairStarted = Number(this.clock.monotonicNowMs());
            response = await gateway.complete({
              system: compiled.system,
              messages: repairMessages,
              temperature: 0.1,
              maxOutputTokens: localizedRepair?.maxOutputTokens
                ?? generationTokenBudget(aggregate.spec.requestedCount ?? 0),
              responseSchema: repairResponseSchema,
              requestId: repairInvocationId
            }, deadline.signal);
            await this.unitOfWork.runAutocommit((context) => this.invocationRepository.updateResult(repairInvocationId, {
              providerRequestId: response.providerRequestId,
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
              latencyMs: Math.max(0, Number(this.clock.monotonicNowMs()) - repairStarted),
              finishReason: response.finishReason
            }, context));
            const repairedText = localizedRepair
              ? localizedRepair.merge(response.text)
              : response.text;
            output = this.parseAndValidateCandidate(
              repairedText,
              aggregate.spec.requestedCount ?? 0,
              capabilityCode(aggregate),
              referencePack
            );
          }
        }
        const parsedWorkflow = this.machine.advance(
          aggregate.workflow,
          GenerationWorkflowStep.ParseStructure,
          this.clock.now(),
          { stagedResult: output.raw }
        );
        await this.unitOfWork.run(async (context) => {
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
      await this.unitOfWork.run(async (context) => {
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
    const pending = await this.pendingInvocation(workflowId);
    await this.unitOfWork.run(async (context) => {
      await this.generationRepository.replaceWorkflow(cancelled, aggregate.workflow.version, context);
      if (pending) await this.invocationRepository.updateValidation(
        pending.id, InvocationValidationStatus.Cancelled, 'generation.cancelled', context
      );
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

  private parseAndValidateCandidate(
    text: string,
    expectedCount: number,
    expectedCapabilityCode: string,
    referencePack?: TrueQuestionReferencePack
  ): GeneratedLectureQuestionSet {
    const output = this.parser.parseText(text, expectedCapabilityCode);
    const report = this.qualityValidator.validate(output, expectedCount, expectedCapabilityCode);
    if (!report.valid) {
      throw new GeneratedContentParseError('generation.quality_invalid', report.blockingIssues);
    }
    this.assertStructuralDifference(output, referencePack);
    return output;
  }

  private assertStructuralDifference(
    output: GeneratedLectureQuestionSet,
    referencePack?: TrueQuestionReferencePack
  ): void {
    const result = this.differenceValidator.evaluate(output, referencePack);
    if (!result.nearDuplicateIndexes.length) return;
    throw new GeneratedContentParseError(
      'generation.true_question_near_duplicate',
      result.nearDuplicateIndexes.map((index) => ({
        code: 'generation.true_question_near_duplicate',
        path: `$.questions[${index}]`,
        message: 'Generated question is too similar to a source question and must be rewritten'
      }))
    );
  }

  private tryAcceptValidSubset(
    text: string,
    error: GeneratedContentParseError,
    expectedCount: number,
    expectedCapabilityCode: string,
    referencePack?: TrueQuestionReferencePack
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
      || retainedQuestions.length / expectedCount < 0.8
    ) return undefined;
    try {
      return {
        output: this.parseAndValidateCandidate(
          JSON.stringify({ ...root, questions: retainedQuestions }),
          expectedCount,
          expectedCapabilityCode,
          referencePack
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
      const pending = await this.pendingInvocation(current.workflow.id);
      await this.unitOfWork.run(async (context) => {
        await this.generationRepository.replaceWorkflow(next, current.workflow.version, context);
        if (pending) await this.invocationRepository.updateValidation(
          pending.id, InvocationValidationStatus.Valid, undefined, context
        );
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
    const pending = invocation ? undefined : await this.pendingInvocation(workflowId);
    await this.unitOfWork.run(async (context) => {
      if (invocation) {
        await this.invocationRepository.append({
          ...invocation,
          validationStatus: cancelled ? InvocationValidationStatus.Cancelled : InvocationValidationStatus.Invalid,
          errorCode: code
        }, context);
      } else if (pending) {
        await this.invocationRepository.updateValidation(
          pending.id,
          cancelled ? InvocationValidationStatus.Cancelled : InvocationValidationStatus.Invalid,
          code,
          context
        );
      }
      await this.generationRepository.replaceWorkflow(terminal, aggregate.workflow.version, context);
    });
  }

  private async pendingInvocation(workflowId: WorkflowId): Promise<AIInvocation | undefined> {
    const invocations = await this.invocationRepository.listByWorkflow(workflowId);
    return [...invocations].reverse().find((item) => item.validationStatus === InvocationValidationStatus.Pending);
  }

  private async requireAggregate(workflowId: WorkflowId): Promise<GenerationAggregate> {
    const aggregate = await this.generationRepository.findByWorkflowId(workflowId);
    if (!aggregate) throw new Error(`Generation workflow does not exist: ${workflowId}`);
    return aggregate;
  }
}

function promptVariables(aggregate: GenerationAggregate) {
  const min = aggregate.spec.difficulty.min;
  const max = aggregate.spec.difficulty.max;
  if (typeof min !== 'number' || typeof max !== 'number') throw new TypeError('Generation difficulty is invalid');
  return {
    QUESTION_COUNT: aggregate.spec.requestedCount ?? 0,
    ASSESSMENT_ROLE: aggregate.spec.assessmentRole,
    DIFFICULTY_MIN: min,
    DIFFICULTY_MAX: max
  };
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

function generationPayload(
  aggregate: GenerationAggregate,
  referencePack?: TrueQuestionReferencePack
): JsonObject {
  return {
    generationSpecId: aggregate.spec.id,
    examCycleId: aggregate.spec.examCycleId,
    capabilityNodeId: aggregate.spec.capabilityNodeId,
    assessmentRole: aggregate.spec.assessmentRole,
    requestedCount: aggregate.spec.requestedCount ?? null,
    difficulty: aggregate.spec.difficulty,
    constraints: aggregate.spec.constraints,
    studentContext: aggregate.spec.contextSnapshot,
    trueQuestionReference: referencePack ? {
      referencePackId: referencePack.id,
      policyVersion: referencePack.policyVersion,
      module: referencePack.module,
      examScope: referencePack.examScope,
      sourceQuestionCount: referencePack.sourceQuestionCount,
      sourceSetCount: referencePack.sourceSetCount,
      questionTypeDistribution: referencePack.questionTypeDistribution,
      difficultyDistribution: referencePack.difficultyDistribution,
      structuralDistribution: referencePack.structuralDistribution,
      distractorPatterns: [...referencePack.distractorPatterns],
      representativeQuestions: referencePack.representativeQuestions.map((question) => ({
        questionId: question.questionId,
        difficulty: question.difficulty,
        material: question.material ?? null,
        prompt: question.prompt,
        options: question.options.map((option) => ({ ...option })),
        correctOptionId: question.correctOptionId,
        structuralSignature: question.structuralSignature
      }))
    } : null
  };
}

function generationTokenBudget(questionCount: number): number {
  return Math.min(14_000, Math.max(5_000, 2_800 + Math.max(1, questionCount) * 900));
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
        'questionPatches 必须保持 index 不变；每个 question 提交完整题干、选项、答案和结构化解析。',
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
        '重新通过指定工具提交完整 lecture 和 questions；不得省略未报错字段，也不得输出 Markdown 代码围栏。'
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
