import type { UnitOfWork } from '@/capabilities/database/public';
import { questionImportPolicyV1 } from '@/capabilities/ai-runtime/public';
import {
  sha256Json,
  type Clock,
  type IdGenerator,
  type JsonValue,
  type QuestionId
} from '@/kernel/public';
import type {
  CommittedQuestionSetBundle,
  ContentRepository,
  ContentSchemaVersion,
  QuestionTemplateVersion,
  GenerationSpecRecord,
  GenerationWorkflowRecord,
  QuestionRecord
} from '../contracts/ContentRepository';
import type { GenerationRepository } from '../contracts/GenerationRepository';
import type {
  QuestionImportDraftRepository,
  QuestionImportPublishReceipt
} from '../contracts/QuestionImportDraftRepository';
import type {
  QuestionSourceImportBundle,
  QuestionSourceRepository
} from '../contracts/QuestionSourceRepository';
import type { QuestionContent } from '../contracts/QuestionContent';
import {
  GenerationWorkflowStatus,
  GenerationWorkflowStep,
  QuestionQualityStatus,
  QuestionSetEntryMode,
  QuestionSetPracticeStatus,
  QuestionSetPurpose,
  QuestionSetStatus,
  questionSchemaCodeFor,
  type QuestionTemplateCode
} from '../domain/ContentCodes';
import { correctAnswerRecord } from '../domain/ChoiceQuestionAnswer';
import type { QuestionSetGradingPolicy } from '../domain/QuestionSetGradingPolicy';
import {
  QuestionImportCandidateStatus,
  QuestionImportDraftStatus
} from '../domain/QuestionImportCodes';
import {
  QuestionCalibrationRole,
  QuestionGenerationIntent,
  QuestionOriginType,
  QuestionSourceRelationRole,
  QuestionSourceStatus
} from '../domain/QuestionSourceCodes';
import { buildQuestionSourceIdentityHash } from '../domain/QuestionSourceIdentity';

export interface PublishQuestionImportDraftCommand {
  readonly draftId: Parameters<QuestionImportDraftRepository['find']>[0];
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export interface PublishQuestionImportDraftResult {
  readonly disposition: 'published' | 'already_published';
  readonly questionSetId: string;
  readonly sourceId: string;
  readonly publishedQuestionCount: number;
}

export class PublishQuestionImportDraft {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly draftRepository: QuestionImportDraftRepository,
    private readonly generationRepository: GenerationRepository,
    private readonly contentRepository: ContentRepository,
    private readonly sourceRepository: QuestionSourceRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    /**
     * Grading rule the set's own subject is scored by, frozen at publish time.
     * Resolved per capability node because a package may score one objective
     * subject differently from another.
     */
    private readonly gradingPolicy: (capabilityNodeId: string) => QuestionSetGradingPolicy | undefined = () => undefined
  ) {}

  /**
   * Published template and schema for every template the paper uses. Resolved
   * together so a paper is rejected before anything is written when one of its
   * question types has no published metadata.
   */
  private async resolveTemplateMetadata(
    templateCodes: readonly QuestionTemplateCode[]
  ): Promise<ReadonlyMap<QuestionTemplateCode, { schema: ContentSchemaVersion; template: QuestionTemplateVersion }>> {
    const resolved = await Promise.all(templateCodes.map(async (templateCode) => {
      const [schema, template] = await Promise.all([
        this.contentRepository.findPublishedSchema(questionSchemaCodeFor(templateCode)),
        this.contentRepository.findPublishedQuestionTemplate(templateCode)
      ]);
      if (!schema || !template || template.contentSchemaVersionId !== schema.id) {
        throw new Error(`Published content metadata for ${templateCode} is unavailable or incompatible`);
      }
      return [templateCode, { schema, template }] as const;
    }));
    return new Map(resolved);
  }

  async execute(command: PublishQuestionImportDraftCommand): Promise<PublishQuestionImportDraftResult> {
    const idempotencyKey = command.idempotencyKey.trim();
    if (!idempotencyKey) throw new TypeError('Question import publish idempotencyKey is required');
    const existingReceipt = await this.draftRepository.findPublishReceipt(idempotencyKey);
    if (existingReceipt) return resultFromReceipt(existingReceipt, 'already_published');

    const aggregate = await this.draftRepository.find(command.draftId);
    if (!aggregate) throw new Error(`Question import draft ${command.draftId} was not found`);
    if (aggregate.draft.status === QuestionImportDraftStatus.Published) {
      throw new Error('Question import draft is already published with another idempotency key');
    }
    if (aggregate.draft.status !== QuestionImportDraftStatus.Confirmed) {
      throw new Error('Question import draft must be confirmed before publishing');
    }
    if (aggregate.draft.version !== command.expectedVersion) {
      throw new Error('Question import draft was changed concurrently');
    }
    const candidates = aggregate.candidates.filter((candidate) => (
      candidate.status === QuestionImportCandidateStatus.Ready
    ));
    if (candidates.length === 0 || candidates.some((candidate) => !candidate.content || !candidate.contentHash)) {
      throw new Error('Question import draft has no publishable questions');
    }

    const questionHashes = candidates.map((candidate) => candidate.contentHash!);
    const payloadHash = await sha256Json(toJson({
      draftId: aggregate.draft.id,
      draftVersion: aggregate.draft.version,
      sourceHash: aggregate.draft.rawPayloadHash,
      questionHashes
    }));
    // Each question binds its own template and schema, so one paper can mix
    // 单选 and 多选 the way a real 试卷 does. The set-level spec still names one
    // template — the one most of the paper uses — because a generation spec
    // describes a single request, not the shape of every question in it.
    const [sameIdentity, sameContent, metadataByTemplate] = await Promise.all([
      this.sourceRepository.findSourceByIdentityHash(await buildQuestionSourceIdentityHash({
        sourceType: aggregate.draft.sourceType,
        ...aggregate.draft.sourceMetadata,
        contentHash: aggregate.draft.rawPayloadHash
      })),
      this.sourceRepository.findSourceByContentHash(aggregate.draft.rawPayloadHash),
      this.resolveTemplateMetadata([...new Set(candidates.map((candidate) => candidate.content!.templateCode))])
    ]);
    if (sameIdentity || sameContent) {
      throw new Error('Question source was already published; use its existing question set instead of importing it again');
    }
    const { schema, template } = metadataByTemplate.get(dominantTemplateCodeOf(candidates))!;

    const now = this.clock.now();
    const sourceId = this.ids.next('QuestionSourceId');
    const questionSetId = this.ids.next('QuestionSetId');
    const generationSpecId = this.ids.next('GenerationSpecId');
    const workflowId = this.ids.next('WorkflowId');
    const questionIds = candidates.map(() => this.ids.next('QuestionId'));
    const questionSetHash = await sha256Json({ questionHashes });
    const spec: GenerationSpecRecord = {
      id: generationSpecId,
      examCycleId: aggregate.draft.examCycleId,
      capabilityNodeId: aggregate.draft.capabilityNodeId,
      contentKind: 'question_set',
      assessmentRole: 'anchor',
      questionTemplateVersionId: template.id,
      contentSchemaVersionId: schema.id,
      promptVersionId: questionImportPolicyV1.versionId,
      generationIntent: QuestionGenerationIntent.TrueQuestionCalibration,
      calibrationTarget: aggregate.draft.capabilityCode,
      requestedCount: candidates.length,
      difficulty: { min: minimumDifficulty(candidates), max: maximumDifficulty(candidates) },
      constraints: {
        source: 'question_import',
        entryMode: QuestionSetEntryMode.Self,
        sourceType: aggregate.draft.sourceType,
        sourceId
      },
      contextSnapshot: {
        capability: {
          code: aggregate.draft.capabilityCode,
          module: aggregate.draft.module
        },
        source: {
          sourceId,
          paperName: aggregate.draft.sourceMetadata.paperName ?? null,
          examYear: aggregate.draft.sourceMetadata.examYear ?? null
        }
      },
      contentHash: payloadHash,
      createdAt: now
    };
    const workflow: GenerationWorkflowRecord = {
      id: workflowId,
      examCycleId: aggregate.draft.examCycleId,
      generationSpecId,
      workflowType: 'question_set',
      status: GenerationWorkflowStatus.Committed,
      currentStep: GenerationWorkflowStep.Complete,
      attemptCount: 1,
      validation: {
        policy: 'question_import_structure_only',
        confirmedDraftId: aggregate.draft.id
      },
      idempotencyKey: `${idempotencyKey}:workflow`,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
      version: 1
    };
    const questions: QuestionRecord[] = candidates.map((candidate, index) => ({
      id: questionIds[index]!,
      questionSetId,
      examCycleId: aggregate.draft.examCycleId,
      capabilityNodeId: aggregate.draft.capabilityNodeId,
      questionTemplateVersionId: metadataByTemplate.get(candidate.content!.templateCode)!.template.id,
      sequence: index + 1,
      difficulty: candidate.difficulty,
      cognitiveLevel: 'application',
      purpose: QuestionSetPurpose.Anchor,
      assessmentRole: 'anchor',
      variantGroupId: candidate.content!.materialGroupId,
      originType: aggregate.draft.sourceType,
      sourceId,
      sourceSequence: candidate.sequence,
      calibrationRole: QuestionCalibrationRole.Anchor,
      isOfficial: aggregate.draft.sourceType === QuestionOriginType.Official,
      content: candidate.content!,
      correctAnswer: correctAnswerRecord(candidate.content!),
      qualityStatus: QuestionQualityStatus.Published,
      contentHash: candidate.contentHash!,
      contentSchemaVersionId: metadataByTemplate.get(candidate.content!.templateCode)!.schema.id,
      contentVersion: 1,
      generatorWorkflowId: workflowId,
      createdAt: now
    }));
    const contentBundle: CommittedQuestionSetBundle = {
      generationSpec: spec,
      generationWorkflow: workflow,
      documents: [],
      lectures: [],
      questionSet: {
        id: questionSetId,
        examCycleId: aggregate.draft.examCycleId,
        capabilityNodeId: aggregate.draft.capabilityNodeId,
        generationSpecId,
        purpose: QuestionSetPurpose.Anchor,
        assessmentRole: 'anchor',
        module: aggregate.draft.module,
        gradingPolicy: this.gradingPolicy(aggregate.draft.capabilityNodeId),
        originType: aggregate.draft.sourceType,
        sourceId,
        calibrationRole: QuestionCalibrationRole.Anchor,
        status: QuestionSetStatus.Ready,
        practiceStatus: QuestionSetPracticeStatus.NotStarted,
        questionCount: questions.length,
        contentHash: questionSetHash,
        contentVersion: 1,
        createdAt: now
      },
      lectureLinks: [],
      questions,
      capabilityLinks: questions.map((question) => ({
        questionId: question.id,
        capabilityNodeId: aggregate.draft.capabilityNodeId,
        relationRole: 'primary',
        weight: 1
      }))
    };
    const sourceIdentityHash = await buildQuestionSourceIdentityHash({
      sourceType: aggregate.draft.sourceType,
      ...aggregate.draft.sourceMetadata,
      contentHash: aggregate.draft.rawPayloadHash
    });
    const sourceBundle: QuestionSourceImportBundle = {
      source: {
        id: sourceId,
        identityHash: sourceIdentityHash,
        sourceType: aggregate.draft.sourceType,
        provider: aggregate.draft.sourceMetadata.provider,
        examType: aggregate.draft.sourceMetadata.examType,
        examYear: aggregate.draft.sourceMetadata.examYear,
        province: aggregate.draft.sourceMetadata.province,
        examBatch: aggregate.draft.sourceMetadata.examBatch,
        paperName: aggregate.draft.sourceMetadata.paperName,
        sectionName: aggregate.draft.sourceMetadata.sectionName,
        provenance: aggregate.draft.sourceMetadata.provenance,
        importMethod: aggregate.draft.importMethod,
        contentHash: aggregate.draft.rawPayloadHash,
        sourceVersion: aggregate.draft.sourceMetadata.sourceVersion,
        status: QuestionSourceStatus.Active,
        createdAt: now,
        updatedAt: now
      },
      links: questions.map((question, index) => ({
        id: this.ids.next('QuestionSourceLinkId'),
        questionId: question.id,
        sourceId,
        sourceSequence: candidates[index]!.sequence,
        materialGroupKey: question.variantGroupId,
        relationRole: QuestionSourceRelationRole.Original,
        calibrationRole: QuestionCalibrationRole.Anchor,
        createdAt: now
      })),
      lineages: [],
      receipt: {
        id: this.ids.next('QuestionSourceImportReceiptId'),
        idempotencyKey: `${idempotencyKey}:source`,
        sourceId,
        payloadHash: aggregate.draft.rawPayloadHash,
        importedQuestionCount: questions.length,
        createdAt: now
      }
    };
    const publishReceipt: QuestionImportPublishReceipt = {
      id: this.ids.next('QuestionImportPublishReceiptId'),
      draftId: aggregate.draft.id,
      idempotencyKey,
      payloadHash,
      questionSetId,
      sourceId,
      publishedQuestionCount: questions.length,
      createdAt: now
    };
    const candidateQuestionIds = Object.fromEntries(
      candidates.map((candidate, index) => [candidate.id, questionIds[index]!])
    ) as Readonly<Record<string, QuestionId>>;

    try {
      await this.unitOfWork.run(async (context) => {
        await this.generationRepository.create({ spec, workflow }, context);
        await this.contentRepository.commitQuestionSet(contentBundle, context);
        await this.sourceRepository.saveImport(sourceBundle, context);
        await this.draftRepository.markPublished(
          aggregate.draft.id,
          aggregate.draft.version,
          questionSetId,
          candidateQuestionIds,
          publishReceipt,
          now,
          context
        );
      });
      return resultFromReceipt(publishReceipt, 'published');
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const concurrent = await this.draftRepository.findPublishReceipt(idempotencyKey);
      if (!concurrent || concurrent.payloadHash !== payloadHash) throw error;
      return resultFromReceipt(concurrent, 'already_published');
    }
  }
}

/**
 * The template most of the paper uses. Names the set-level generation spec,
 * which describes one request rather than every question's own shape.
 */
function dominantTemplateCodeOf(
  candidates: readonly { readonly content?: QuestionContent }[]
): QuestionTemplateCode {
  const counts = new Map<QuestionTemplateCode, number>();
  for (const candidate of candidates) {
    const code = candidate.content!.templateCode;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]![0];
}

function resultFromReceipt(
  receipt: QuestionImportPublishReceipt,
  disposition: PublishQuestionImportDraftResult['disposition']
): PublishQuestionImportDraftResult {
  return {
    disposition,
    questionSetId: receipt.questionSetId,
    sourceId: receipt.sourceId,
    publishedQuestionCount: receipt.publishedQuestionCount
  };
}

function minimumDifficulty(candidates: readonly { readonly difficulty: number }[]): number {
  return Math.min(...candidates.map((candidate) => candidate.difficulty));
}

function maximumDifficulty(candidates: readonly { readonly difficulty: number }[]): number {
  return Math.max(...candidates.map((candidate) => candidate.difficulty));
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'ConstraintError'
    || /UNIQUE constraint failed|Key already exists|already exists in the object store/i.test(error.message)
  );
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
