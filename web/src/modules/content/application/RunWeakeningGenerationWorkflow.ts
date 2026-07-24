import type { AIInvocation, AIInvocationRepository, PromptCompiler, PromptRepository, ProviderGateway } from '@/capabilities/ai-runtime/public';
import { InvocationValidationStatus, ModelMessageRole, ProviderGatewayError } from '@/capabilities/ai-runtime/public';
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
import { WeakeningContentQualityValidator } from './WeakeningContentQualityValidator';

export interface GenerationWorkflowResult {
  readonly workflow: GenerationWorkflowRecord;
  readonly questionSetId?: string;
}

export class RunWeakeningGenerationWorkflow {
  private readonly machine = new GenerationWorkflowMachine();
  private readonly parser = new GeneratedContentParser();
  private readonly qualityValidator = new WeakeningContentQualityValidator();
  private readonly commitBuilder: GeneratedContentCommitBuilder;

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly generationRepository: GenerationRepository,
    private readonly contentRepository: ContentRepository,
    private readonly promptRepository: PromptRepository,
    private readonly invocationRepository: AIInvocationRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly promptCompiler: PromptCompiler,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {
    this.commitBuilder = new GeneratedContentCommitBuilder(clock, ids);
  }

  async execute(
    workflowId: WorkflowId,
    gateway: ProviderGateway,
    signal?: AbortSignal
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
    try {
      signal?.throwIfAborted();
      const promptBundle = await this.promptRepository.findById(aggregate.spec.promptVersionId);
      if (!promptBundle) throw new Error(`Prompt version is unavailable: ${aggregate.spec.promptVersionId}`);
      let output: GeneratedLectureQuestionSet;
      if (aggregate.workflow.stagedResult) {
        output = this.parser.parseObject(aggregate.workflow.stagedResult);
      } else {
        aggregate = await this.advanceToInvocation(aggregate);
        if (aggregate.workflow.currentStep !== GenerationWorkflowStep.InvokeModel) {
          throw new Error(`Generation checkpoint has no staged result at ${aggregate.workflow.currentStep}`);
        }
        const compiled = this.promptCompiler.compile(
          promptBundle.promptCode,
          promptVariables(aggregate),
          generationPayload(aggregate),
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
        await this.unitOfWork.run((context) => this.invocationRepository.append(invocation!, context));
        invocation = undefined;
        const response = await gateway.complete({
          system: compiled.system,
          messages: [{ role: ModelMessageRole.User, content: compiled.user }],
          temperature: 0.2,
          maxOutputTokens: 16_000,
          responseSchema: compiled.responseSchema,
          requestId: invocationId
        }, signal);
        const invocationResult = {
          providerRequestId: response.providerRequestId,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          latencyMs: Math.max(0, Number(this.clock.monotonicNowMs()) - started),
          finishReason: response.finishReason
        };
        await this.unitOfWork.run((context) => this.invocationRepository.updateResult(invocationId, invocationResult, context));
        output = this.parser.parseText(response.text);
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

      aggregate = await this.finishValidationSteps(aggregate, output);
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
      const bundle = await this.commitBuilder.build(aggregate.spec, completedWorkflow, lectureSchema.id, output);
      await this.unitOfWork.run(async (context) => {
        await this.contentRepository.commitQuestionSet(bundle, context);
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
    await this.unitOfWork.run((context) => (
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

  private async finishValidationSteps(
    aggregate: GenerationAggregate,
    output: GeneratedLectureQuestionSet
  ): Promise<GenerationAggregate> {
    let current = await this.advanceIfAt(
      aggregate,
      GenerationWorkflowStep.ParseStructure,
      GenerationWorkflowStep.ValidateSchema
    );
    if (current.workflow.currentStep === GenerationWorkflowStep.ValidateSchema) {
      const report = this.qualityValidator.validate(output, current.spec.requestedCount ?? 0);
      if (!report.valid) {
        const error = new GeneratedContentParseError('generation.quality_invalid', report.issues);
        throw error;
      }
      const next = this.machine.advance(
        current.workflow,
        GenerationWorkflowStep.ValidateDomain,
        this.clock.now(),
        { validation: { schema: 'valid', domain: 'valid', quality: report.metrics } }
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
    return this.unitOfWork.run((context) => (
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

function generationPayload(aggregate: GenerationAggregate): JsonObject {
  return {
    generationSpecId: aggregate.spec.id,
    examCycleId: aggregate.spec.examCycleId,
    capabilityNodeId: aggregate.spec.capabilityNodeId,
    assessmentRole: aggregate.spec.assessmentRole,
    requestedCount: aggregate.spec.requestedCount ?? null,
    difficulty: aggregate.spec.difficulty,
    constraints: aggregate.spec.constraints,
    studentContext: aggregate.spec.contextSnapshot
  };
}

function isTerminal(workflow: GenerationWorkflowRecord): boolean {
  return workflow.status === GenerationWorkflowStatus.Committed
    || workflow.status === GenerationWorkflowStatus.Failed
    || workflow.status === GenerationWorkflowStatus.Cancelled;
}

function errorCode(error: unknown, cancelled: boolean): string {
  if (cancelled || isAbortError(error)) return 'generation.cancelled';
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
