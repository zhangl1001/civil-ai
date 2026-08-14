import {
  sha256Json,
  type CapabilityNodeId,
  type Clock,
  type ContentSchemaVersionId,
  type IdGenerator,
  type JsonValue,
  type QuestionId
} from '@/kernel/public';
import type { CommittedQuestionSetBundle, GenerationSpecRecord, GenerationWorkflowRecord } from '../contracts/ContentRepository';
import type { QuestionLineageRecord } from '../contracts/QuestionSourceRepository';
import type { TrueQuestionReferencePack } from '../contracts/QuestionReferencePackRepository';
import {
  ContentAssetStatus,
  ContentDocumentType,
  QuestionQualityStatus,
  QuestionSetPracticeStatus,
  QuestionSetPurpose,
  QuestionSetStatus
} from '../domain/ContentCodes';
import { correctAnswerRecord } from '../domain/ChoiceQuestionAnswer';
import type { QuestionSetGradingPolicy } from '../domain/QuestionSetGradingPolicy';
import {
  QuestionCalibrationRole,
  QuestionDerivationType,
  QuestionOriginType
} from '../domain/QuestionSourceCodes';
import type { GeneratedLectureQuestionSet } from './GeneratedContentParser';

export interface GeneratedContentCommit {
  readonly bundle: CommittedQuestionSetBundle;
  readonly lineages: readonly QuestionLineageRecord[];
}

export class GeneratedContentCommitBuilder {
  constructor(
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    /**
     * Grading rule the set's own subject is scored by, frozen at publish time.
     * Resolved per capability node because a package may score one objective
     * subject differently from another.
     */
    private readonly gradingPolicy: (capabilityNodeId: string) => QuestionSetGradingPolicy | undefined = () => undefined
  ) {}

  async build(
    spec: GenerationSpecRecord,
    completedWorkflow: GenerationWorkflowRecord,
    lectureSchemaVersionId: ContentSchemaVersionId,
    output: GeneratedLectureQuestionSet,
    referencePack?: TrueQuestionReferencePack
  ): Promise<GeneratedContentCommit> {
    if (!spec.questionTemplateVersionId) throw new Error('Question generation spec requires a question template');
    const now = this.clock.now();
    const lectureDocumentId = this.ids.next('ContentDocumentId');
    const lectureId = this.ids.next('LectureId');
    const questionSetId = this.ids.next('QuestionSetId');
    const capability = capabilitySnapshot(spec);
    const questionHashes = await Promise.all(output.questions.map((question) => sha256Json(toJson(question))));
    const questionSetHash = await sha256Json({ questionHashes });
    const capabilityNodeId = spec.capabilityNodeId as CapabilityNodeId;
    const references = new Map(
      referencePack?.representativeQuestions.map((question) => [question.questionId, question]) ?? []
    );
    const questionIds = output.questions.map(() => this.ids.next('QuestionId'));
    const lineageIds = output.referenceQuestionIds.map((referenceQuestionId) => (
      referenceQuestionId && references.has(referenceQuestionId as QuestionId)
        ? this.ids.next('QuestionLineageId')
        : undefined
    ));
    const questions = output.questions.map((question, index) => {
      const referenceQuestionId = output.referenceQuestionIds[index] as QuestionId | undefined;
      const reference = referenceQuestionId ? references.get(referenceQuestionId) : undefined;
      const difficulty = distributedDifficulty(spec, index, output.questions.length);
      return {
        id: questionIds[index]!,
        questionSetId,
        examCycleId: spec.examCycleId,
        capabilityNodeId,
        questionTemplateVersionId: spec.questionTemplateVersionId!,
        sequence: index + 1,
        difficulty,
        cognitiveLevel: 'application',
        purpose: purposeForRole(spec.assessmentRole),
        assessmentRole: spec.assessmentRole,
        variantGroupId: question.materialGroupId,
        originType: reference ? QuestionOriginType.AiVariant : QuestionOriginType.AiGenerated,
        lineageId: lineageIds[index],
        calibrationRole: reference
          ? QuestionCalibrationRole.StyleReference
          : referencePack
            ? QuestionCalibrationRole.DistributionReference
            : QuestionCalibrationRole.None,
        isOfficial: false,
        content: question,
        correctAnswer: correctAnswerRecord(question),
        qualityStatus: QuestionQualityStatus.Published,
        contentHash: questionHashes[index],
        contentSchemaVersionId: spec.contentSchemaVersionId,
        contentVersion: 1,
        generatorWorkflowId: completedWorkflow.id,
        createdAt: now
      };
    });
    const lineages = output.referenceQuestionIds.flatMap((rawReferenceQuestionId, index) => {
      const referenceQuestionId = rawReferenceQuestionId as QuestionId | undefined;
      const reference = referenceQuestionId ? references.get(referenceQuestionId) : undefined;
      const lineageId = lineageIds[index];
      if (!reference || !lineageId) return [];
      return [{
        id: lineageId,
        questionId: questionIds[index]!,
        parentQuestionId: reference.questionId,
        derivationType: derivationType(spec.assessmentRole),
        generationWorkflowId: completedWorkflow.id,
        referenceSnapshot: {
          referencePackId: referencePack!.id,
          referencePolicyVersion: referencePack!.policyVersion,
          parentDifficulty: reference.difficulty,
          generatedDifficulty: distributedDifficulty(spec, index, output.questions.length),
          parentStructuralSignature: reference.structuralSignature
        },
        createdAt: now
      } satisfies QuestionLineageRecord];
    });
    const calibratedAsVariants = lineages.length > 0 && lineages.length === questions.length;
    return {
      bundle: {
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
        gradingPolicy: this.gradingPolicy(spec.capabilityNodeId),
        originType: calibratedAsVariants
          ? QuestionOriginType.AiVariant
          : QuestionOriginType.AiGenerated,
        calibrationRole: referencePack
          ? calibratedAsVariants
            ? QuestionCalibrationRole.StyleReference
            : QuestionCalibrationRole.DistributionReference
          : QuestionCalibrationRole.None,
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
      },
      lineages
    };
  }
}

function derivationType(
  role: GenerationSpecRecord['assessmentRole']
): QuestionDerivationType {
  if (role === 'transfer') return QuestionDerivationType.Transfer;
  return QuestionDerivationType.Variant;
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

function distributedDifficulty(spec: GenerationSpecRecord, index: number, count: number): number {
  const min = spec.difficulty.min;
  const max = spec.difficulty.max;
  if (typeof min !== 'number' || typeof max !== 'number') throw new TypeError('Generation difficulty snapshot is invalid');
  if (count <= 1 || min === max) return roundDifficulty((min + max) / 2);
  const normalizedIndex = Math.max(0, Math.min(index, count - 1));
  return roundDifficulty(min + ((max - min) * normalizedIndex) / (count - 1));
}

function roundDifficulty(value: number): number {
  return Math.round(value * 100) / 100;
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
