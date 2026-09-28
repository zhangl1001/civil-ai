import type { UnitOfWork } from '@/capabilities/database/public';
import {
  canonicalJson,
  sha256Json,
  type AgentRunId,
  type CapabilityNodeId,
  type Clock,
  type ExamCycleId,
  type IdGenerator,
  type JsonObject,
  type LearningThreadId,
  type PromptVersionId,
  type TeachingBlueprintId,
  type AssessmentRole
} from '@/kernel/public';
import type { OutboxRepository } from '@/modules/task/public';
import type { ContentRepository, GenerationSpecRecord, GenerationWorkflowRecord } from '../contracts/ContentRepository';
import type { GenerationAggregate, GenerationRepository } from '../contracts/GenerationRepository';
import {
  ContentEventType,
  ContentResourceType,
  ContentSchemaCode,
  GenerationWorkflowStatus,
  GenerationWorkflowStep,
  QuestionTemplateCode
} from '../domain/ContentCodes';
import { GenerationContextCompiler } from './GenerationContextCompiler';
import { BuildTrueQuestionReferencePack } from './BuildTrueQuestionReferencePack';
import { QuestionGenerationIntent } from '../domain/QuestionSourceCodes';

export interface CreateGenerationWorkflowCommand {
  readonly idempotencyKey: string;
  readonly sourceAgentRunId?: AgentRunId;
  readonly examCycleId: ExamCycleId;
  readonly learningThreadId?: LearningThreadId;
  readonly teachingBlueprintId?: TeachingBlueprintId;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly assessmentRole: AssessmentRole;
  readonly requestedCount: number;
  readonly difficultyMin: number;
  readonly difficultyMax: number;
  readonly constraints?: JsonObject;
}

/**
 * An idempotency key names exactly one generation request. Reusing it for a
 * different request is a caller bug: silently answering with the first
 * request's question set is how every batch of a mock exam once received the
 * same set, so it fails loudly instead.
 */
export class GenerationRequestConflictError extends Error {
  readonly code = 'content.generation_request_conflict';

  constructor(idempotencyKey: string) {
    super(`Generation idempotency key was already used for a different request: ${idempotencyKey}`);
    this.name = 'GenerationRequestConflictError';
  }
}

export class CreateGenerationWorkflow {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly generationRepository: GenerationRepository,
    private readonly contentRepository: ContentRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly contextCompiler: GenerationContextCompiler,
    private readonly buildReferencePack: BuildTrueQuestionReferencePack,
    private readonly promptVersionId: PromptVersionId,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: CreateGenerationWorkflowCommand): Promise<GenerationAggregate> {
    if (!command.idempotencyKey.trim()) throw new Error('Generation idempotency key is required');
    const existing = await this.generationRepository.findByIdempotencyKey(command.idempotencyKey);
    if (existing) return sameRequestOrThrow(existing, command);
    const [compiled, referencePack, schema, template] = await Promise.all([
      this.contextCompiler.compile(command),
      this.buildReferencePack.execute(command),
      this.contentRepository.findPublishedSchema(ContentSchemaCode.SingleChoiceQuestion),
      this.contentRepository.findPublishedQuestionTemplate(QuestionTemplateCode.SingleChoice)
    ]);
    if (!schema) throw new Error(`Published content schema is unavailable: ${ContentSchemaCode.SingleChoiceQuestion}`);
    if (!template) throw new Error(`Published question template is unavailable: ${QuestionTemplateCode.SingleChoice}`);
    if (template.contentSchemaVersionId !== schema.id) {
      throw new Error('Published question template and content schema are incompatible');
    }
    const now = this.clock.now();
    const generationSpecId = this.ids.next('GenerationSpecId');
    const workflowId = this.ids.next('WorkflowId');
    const difficulty: JsonObject = { min: command.difficultyMin, max: command.difficultyMax };
    const constraints: JsonObject = command.constraints ?? {};
    const hashPayload: JsonObject = {
      sourceAgentRunId: command.sourceAgentRunId ?? null,
      examCycleId: command.examCycleId,
      learningThreadId: command.learningThreadId ?? null,
      teachingBlueprintId: command.teachingBlueprintId ?? null,
      capabilityNodeId: command.capabilityNodeId,
      contentKind: 'lecture_with_questions',
      assessmentRole: command.assessmentRole,
      questionTemplateVersionId: template.id,
      contentSchemaVersionId: schema.id,
      promptVersionId: this.promptVersionId,
      referencePackId: referencePack?.id ?? null,
      referencePolicyVersion: referencePack?.policyVersion ?? null,
      generationIntent: generationIntent(command),
      calibrationTarget: referencePack
        ? `${referencePack.module}:${referencePack.capabilityNodeId}`
        : null,
      requestedCount: command.requestedCount,
      difficulty,
      constraints,
      contextSnapshot: compiled.snapshot
    };
    const spec: GenerationSpecRecord = {
      id: generationSpecId,
      sourceAgentRunId: command.sourceAgentRunId,
      examCycleId: command.examCycleId,
      learningThreadId: command.learningThreadId,
      teachingBlueprintId: command.teachingBlueprintId,
      capabilityNodeId: command.capabilityNodeId,
      contentKind: 'lecture_with_questions',
      assessmentRole: command.assessmentRole,
      questionTemplateVersionId: template.id,
      contentSchemaVersionId: schema.id,
      promptVersionId: this.promptVersionId,
      referencePackId: referencePack?.id,
      referencePolicyVersion: referencePack?.policyVersion,
      generationIntent: generationIntent(command),
      calibrationTarget: referencePack
        ? `${referencePack.module}:${referencePack.capabilityNodeId}`
        : undefined,
      requestedCount: command.requestedCount,
      difficulty,
      constraints,
      contextSnapshot: compiled.snapshot,
      contentHash: await sha256Json(hashPayload),
      createdAt: now
    };
    const workflow: GenerationWorkflowRecord = {
      id: workflowId,
      examCycleId: command.examCycleId,
      generationSpecId,
      workflowType: 'lecture_with_questions',
      status: GenerationWorkflowStatus.Queued,
      currentStep: GenerationWorkflowStep.PrepareContext,
      attemptCount: 0,
      validation: {},
      idempotencyKey: command.idempotencyKey,
      startedAt: now,
      updatedAt: now,
      version: 1
    };
    const aggregate = { spec, workflow };
    try {
      await this.unitOfWork.run(async (context) => {
        await this.generationRepository.create(aggregate, context);
        await this.outboxRepository.append({
          id: this.ids.next('OutboxEventId'),
          aggregateType: ContentResourceType.GenerationWorkflow,
          aggregateId: workflow.id,
          eventType: ContentEventType.GenerationRequested,
          payload: {
            workflowId: workflow.id,
            generationSpecId: spec.id,
            rootAgentRunId: spec.sourceAgentRunId ?? null,
            examCycleId: spec.examCycleId,
            capabilityNodeId: spec.capabilityNodeId
          },
          occurredAt: now,
          attemptCount: 0,
          idempotencyKey: `${command.idempotencyKey}:generation-requested`
        }, context);
      });
      return aggregate;
    } catch (error) {
      const concurrent = await this.generationRepository.findByIdempotencyKey(command.idempotencyKey);
      if (concurrent) return sameRequestOrThrow(concurrent, command);
      throw error;
    }
  }
}

function sameRequestOrThrow(
  aggregate: GenerationAggregate,
  command: CreateGenerationWorkflowCommand
): GenerationAggregate {
  const { spec } = aggregate;
  // Compared on what the caller asked for, not on what was derived from it: a
  // retry may land on a newer context snapshot, reference pack or learning
  // thread and is still the same request. Free-form constraints are left out
  // for the same reason (their shape evolves between releases, and a run that
  // retries across an upgrade must still find its generation); their purpose
  // is compared through the generation intent they resolve to. Fields an older
  // spec never stored are not held against it.
  const stored = requestFingerprint({
    examCycleId: spec.examCycleId,
    capabilityNodeId: spec.capabilityNodeId,
    assessmentRole: spec.assessmentRole,
    requestedCount: spec.requestedCount,
    difficultyMin: spec.difficulty.min,
    difficultyMax: spec.difficulty.max,
    generationIntent: spec.generationIntent,
    sourceAgentRunId: spec.sourceAgentRunId,
    teachingBlueprintId: spec.teachingBlueprintId
  });
  const requested = requestFingerprint({
    examCycleId: command.examCycleId,
    capabilityNodeId: command.capabilityNodeId,
    assessmentRole: command.assessmentRole,
    requestedCount: spec.requestedCount === undefined ? undefined : command.requestedCount,
    difficultyMin: command.difficultyMin,
    difficultyMax: command.difficultyMax,
    generationIntent: spec.generationIntent === undefined ? undefined : generationIntent(command),
    sourceAgentRunId: spec.sourceAgentRunId === undefined ? undefined : command.sourceAgentRunId,
    teachingBlueprintId: spec.teachingBlueprintId === undefined ? undefined : command.teachingBlueprintId
  });
  if (stored !== requested) throw new GenerationRequestConflictError(command.idempotencyKey);
  return aggregate;
}

function requestFingerprint(request: {
  readonly examCycleId: string;
  readonly capabilityNodeId: string;
  readonly assessmentRole: string;
  readonly requestedCount?: number;
  readonly difficultyMin: unknown;
  readonly difficultyMax: unknown;
  readonly generationIntent?: string;
  readonly sourceAgentRunId?: string;
  readonly teachingBlueprintId?: string;
}): string {
  return canonicalJson({
    examCycleId: request.examCycleId,
    capabilityNodeId: request.capabilityNodeId,
    assessmentRole: request.assessmentRole,
    requestedCount: request.requestedCount ?? null,
    difficultyMin: typeof request.difficultyMin === 'number' ? request.difficultyMin : null,
    difficultyMax: typeof request.difficultyMax === 'number' ? request.difficultyMax : null,
    generationIntent: request.generationIntent ?? null,
    sourceAgentRunId: request.sourceAgentRunId ?? null,
    teachingBlueprintId: request.teachingBlueprintId ?? null
  });
}

function generationIntent(command: CreateGenerationWorkflowCommand): QuestionGenerationIntent {
  const authority = command.constraints?.selectionAuthority;
  const source = command.constraints?.source;
  if (authority === 'user' || source === 'custom') return QuestionGenerationIntent.UserDirected;
  if (command.assessmentRole === 'retention') return QuestionGenerationIntent.RetentionReview;
  if (command.assessmentRole === 'transfer') return QuestionGenerationIntent.TransferAssessment;
  if (command.assessmentRole === 'anchor') return QuestionGenerationIntent.DiagnosticBaseline;
  return QuestionGenerationIntent.TargetedTraining;
}
