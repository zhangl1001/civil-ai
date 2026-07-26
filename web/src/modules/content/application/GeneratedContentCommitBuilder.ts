import {
  sha256Json,
  type CapabilityNodeId,
  type Clock,
  type ContentSchemaVersionId,
  type IdGenerator,
  type JsonValue
} from '@/kernel/public';
import type { CommittedQuestionSetBundle, GenerationSpecRecord, GenerationWorkflowRecord } from '../contracts/ContentRepository';
import {
  ContentAssetStatus,
  ContentDocumentType,
  QuestionQualityStatus,
  QuestionSetPracticeStatus,
  QuestionSetPurpose,
  QuestionSetStatus
} from '../domain/ContentCodes';
import type { GeneratedLectureQuestionSet } from './GeneratedContentParser';

export class GeneratedContentCommitBuilder {
  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async build(
    spec: GenerationSpecRecord,
    completedWorkflow: GenerationWorkflowRecord,
    lectureSchemaVersionId: ContentSchemaVersionId,
    output: GeneratedLectureQuestionSet
  ): Promise<CommittedQuestionSetBundle> {
    if (!spec.questionTemplateVersionId) throw new Error('Question generation spec requires a question template');
    const now = this.clock.now();
    const lectureDocumentId = this.ids.next('ContentDocumentId');
    const lectureId = this.ids.next('LectureId');
    const questionSetId = this.ids.next('QuestionSetId');
    const capability = capabilitySnapshot(spec);
    const questionHashes = await Promise.all(output.questions.map((question) => sha256Json(toJson(question))));
    const questionSetHash = await sha256Json({ questionHashes });
    const capabilityNodeId = spec.capabilityNodeId as CapabilityNodeId;
    const questions = output.questions.map((question, index) => ({
      id: this.ids.next('QuestionId'),
      questionSetId,
      examCycleId: spec.examCycleId,
      capabilityNodeId,
      questionTemplateVersionId: spec.questionTemplateVersionId!,
      sequence: index + 1,
      difficulty: averageDifficulty(spec),
      cognitiveLevel: 'application',
      purpose: purposeForRole(spec.assessmentRole),
      assessmentRole: spec.assessmentRole,
      variantGroupId: question.materialGroupId,
      content: question,
      correctAnswer: { optionId: question.correctOptionId },
      qualityStatus: QuestionQualityStatus.Published,
      contentHash: questionHashes[index],
      contentSchemaVersionId: spec.contentSchemaVersionId,
      contentVersion: 1,
      generatorWorkflowId: completedWorkflow.id,
      createdAt: now
    }));
    return {
      generationSpec: spec,
      generationWorkflow: completedWorkflow,
      documents: [{
        id: lectureDocumentId,
        examCycleId: spec.examCycleId,
        documentType: ContentDocumentType.Lecture,
        schemaVersionId: lectureSchemaVersionId,
        title: `${capability.name}系统讲义`,
        content: output.lecture,
        contentHash: await sha256Json(toJson(output.lecture)),
        status: ContentAssetStatus.Published,
        contentVersion: 1,
        generatorWorkflowId: completedWorkflow.id,
        createdAt: now
      }],
      lectures: [{
        id: lectureId,
        examCycleId: spec.examCycleId,
        learningThreadId: spec.learningThreadId,
        teachingBlueprintId: spec.teachingBlueprintId,
        capabilityNodeId,
        contentDocumentId: lectureDocumentId,
        objective: `掌握${capability.name}的核心概念、方法和典型题型`,
        status: 'ready',
        version: 1,
        createdAt: now
      }],
      questionSet: {
        id: questionSetId,
        examCycleId: spec.examCycleId,
        learningThreadId: spec.learningThreadId,
        teachingBlueprintId: spec.teachingBlueprintId,
        capabilityNodeId,
        generationSpecId: spec.id,
        purpose: purposeForRole(spec.assessmentRole),
        assessmentRole: spec.assessmentRole,
        module: capability.module,
        status: QuestionSetStatus.Ready,
        practiceStatus: QuestionSetPracticeStatus.NotStarted,
        questionCount: questions.length,
        contentHash: questionSetHash,
        contentVersion: 1,
        createdAt: now
      },
      lectureLinks: [{ lectureId, questionSetId, relationRole: 'primary' }],
      questions,
      capabilityLinks: questions.map((question) => ({
        questionId: question.id,
        capabilityNodeId,
        relationRole: 'primary',
        weight: 1
      }))
    };
  }
}

function capabilitySnapshot(spec: GenerationSpecRecord): { name: string; module: string } {
  const capability = (spec.contextSnapshot as { capability?: { name?: unknown; module?: unknown } }).capability;
  const name = typeof capability?.name === 'string' && capability.name.trim()
    ? capability.name.trim()
    : '专项能力';
  const module = typeof capability?.module === 'string' && capability.module.trim()
    ? capability.module.trim()
    : 'practice';
  return { name, module };
}

function purposeForRole(role: GenerationSpecRecord['assessmentRole']): QuestionSetPurpose {
  return role;
}

function averageDifficulty(spec: GenerationSpecRecord): number {
  const min = spec.difficulty.min;
  const max = spec.difficulty.max;
  if (typeof min !== 'number' || typeof max !== 'number') throw new TypeError('Generation difficulty snapshot is invalid');
  return Math.round(((min + max) / 2) * 100) / 100;
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
