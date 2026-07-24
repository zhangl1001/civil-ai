import type { UnitOfWork } from '@/capabilities/database/public';
import {
  sha256Json,
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

export interface CreateGenerationWorkflowCommand {
  readonly idempotencyKey: string;
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

export class CreateGenerationWorkflow {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly generationRepository: GenerationRepository,
    private readonly contentRepository: ContentRepository,
    private readonly outboxRepository: OutboxRepository,
    private readonly contextCompiler: GenerationContextCompiler,
    private readonly promptVersionId: PromptVersionId,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: CreateGenerationWorkflowCommand): Promise<GenerationAggregate> {
    if (!command.idempotencyKey.trim()) throw new Error('Generation idempotency key is required');
    const existing = await this.generationRepository.findByIdempotencyKey(command.idempotencyKey);
    if (existing) return existing;
    const [compiled, schema, template] = await Promise.all([
      this.contextCompiler.compile(command),
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
      examCycleId: command.examCycleId,
      learningThreadId: command.learningThreadId ?? null,
      teachingBlueprintId: command.teachingBlueprintId ?? null,
      capabilityNodeId: command.capabilityNodeId,
      contentKind: 'lecture_with_questions',
      assessmentRole: command.assessmentRole,
      questionTemplateVersionId: template.id,
      contentSchemaVersionId: schema.id,
      promptVersionId: this.promptVersionId,
      requestedCount: command.requestedCount,
      difficulty,
      constraints,
      contextSnapshot: compiled.snapshot
    };
    const spec: GenerationSpecRecord = {
      id: generationSpecId,
      examCycleId: command.examCycleId,
      learningThreadId: command.learningThreadId,
      teachingBlueprintId: command.teachingBlueprintId,
      capabilityNodeId: command.capabilityNodeId,
      contentKind: 'lecture_with_questions',
      assessmentRole: command.assessmentRole,
      questionTemplateVersionId: template.id,
      contentSchemaVersionId: schema.id,
      promptVersionId: this.promptVersionId,
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
      if (concurrent) return concurrent;
      throw error;
    }
  }
}
