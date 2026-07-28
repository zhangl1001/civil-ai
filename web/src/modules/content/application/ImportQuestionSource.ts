import type { UnitOfWork } from '@/capabilities/database/public';
import {
  type Clock,
  type IdGenerator,
  type InstantMs,
  type JsonObject,
  type QuestionId,
  type WorkflowId
} from '@/kernel/public';
import type {
  QuestionSourceImportReceipt,
  QuestionSourceRecord,
  QuestionSourceRepository
} from '../contracts/QuestionSourceRepository';
import {
  QuestionCalibrationRole,
  QuestionImportMethod,
  QuestionOriginType,
  QuestionSourceRelationRole,
  QuestionSourceStatus,
  type QuestionDerivationType
} from '../domain/QuestionSourceCodes';
import { buildQuestionSourceIdentityHash } from '../domain/QuestionSourceIdentity';

export interface ImportQuestionSourceLink {
  readonly questionId: QuestionId;
  readonly sourceSequence?: number;
  readonly materialGroupKey?: string;
  readonly relationRole?: QuestionSourceRelationRole;
  readonly calibrationRole?: QuestionCalibrationRole;
}

export interface ImportQuestionLineage {
  readonly questionId: QuestionId;
  readonly parentQuestionId: QuestionId;
  readonly derivationType: QuestionDerivationType;
  readonly generationWorkflowId?: WorkflowId;
  readonly referenceSnapshot?: JsonObject;
}

export interface ImportQuestionSourceCommand {
  readonly idempotencyKey: string;
  readonly sourceType: QuestionOriginType;
  readonly provider?: string;
  readonly examType?: string;
  readonly examYear?: number;
  readonly province?: string;
  readonly examBatch?: string;
  readonly paperName?: string;
  readonly sectionName?: string;
  readonly provenance: JsonObject;
  readonly importMethod: QuestionImportMethod;
  readonly contentHash: string;
  readonly sourceVersion?: string;
  readonly links: readonly ImportQuestionSourceLink[];
  readonly lineages?: readonly ImportQuestionLineage[];
}

export interface ImportQuestionSourceResult {
  readonly source: QuestionSourceRecord;
  readonly disposition: 'created' | 'already_imported';
  readonly importedQuestionCount: number;
}

export class QuestionSourceImportConflictError extends Error {
  readonly code = 'content.question_source_import_conflict';

  constructor(message: string) {
    super(message);
    this.name = 'QuestionSourceImportConflictError';
  }
}

export class ImportQuestionSource {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: QuestionSourceRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  async execute(command: ImportQuestionSourceCommand): Promise<ImportQuestionSourceResult> {
    const normalized = normalizeCommand(command);
    const identityHash = await buildQuestionSourceIdentityHash({
      ...normalized,
      contentHash: normalized.contentHash
    });
    const existingReceipt = await this.repository.findImportReceipt(normalized.idempotencyKey);
    if (existingReceipt) return this.resultFromReceipt(existingReceipt, normalized.contentHash);

    const [sameIdentity, sameContent] = await Promise.all([
      this.repository.findSourceByIdentityHash(identityHash),
      this.repository.findSourceByContentHash(normalized.contentHash)
    ]);
    if (sameIdentity || sameContent) {
      const source = resolveMatchingSource(sameIdentity, sameContent, identityHash, normalized.contentHash);
      await this.saveReceipt(source, normalized);
      return {
        source,
        disposition: 'already_imported',
        importedQuestionCount: normalized.links.length
      };
    }

    const now = this.clock.now();
    const source: QuestionSourceRecord = {
      id: this.ids.next('QuestionSourceId'),
      identityHash,
      sourceType: normalized.sourceType,
      provider: normalized.provider,
      examType: normalized.examType,
      examYear: normalized.examYear,
      province: normalized.province,
      examBatch: normalized.examBatch,
      paperName: normalized.paperName,
      sectionName: normalized.sectionName,
      provenance: normalized.provenance,
      importMethod: normalized.importMethod,
      contentHash: normalized.contentHash,
      sourceVersion: normalized.sourceVersion,
      status: QuestionSourceStatus.Active,
      createdAt: now,
      updatedAt: now
    };
    const receipt = this.createReceipt(source, normalized, now);
    try {
      await this.unitOfWork.run(async (context) => {
        await this.repository.saveImport({
          source,
          links: normalized.links.map((link) => ({
            id: this.ids.next('QuestionSourceLinkId'),
            questionId: link.questionId,
            sourceId: source.id,
            sourceSequence: link.sourceSequence,
            materialGroupKey: link.materialGroupKey,
            relationRole: link.relationRole,
            calibrationRole: link.calibrationRole,
            createdAt: now
          })),
          lineages: normalized.lineages.map((lineage) => ({
            id: this.ids.next('QuestionLineageId'),
            questionId: lineage.questionId,
            parentQuestionId: lineage.parentQuestionId,
            derivationType: lineage.derivationType,
            generationWorkflowId: lineage.generationWorkflowId,
            referenceSnapshot: lineage.referenceSnapshot,
            createdAt: now
          })),
          receipt
        }, context);
      });
      return {
        source,
        disposition: 'created',
        importedQuestionCount: normalized.links.length
      };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const concurrentReceipt = await this.repository.findImportReceipt(normalized.idempotencyKey);
      if (concurrentReceipt) return this.resultFromReceipt(concurrentReceipt, normalized.contentHash);
      const concurrentSource = await this.repository.findSourceByIdentityHash(identityHash);
      if (!concurrentSource || concurrentSource.contentHash !== normalized.contentHash) throw error;
      await this.saveReceipt(concurrentSource, normalized);
      return {
        source: concurrentSource,
        disposition: 'already_imported',
        importedQuestionCount: normalized.links.length
      };
    }
  }

  private async resultFromReceipt(
    receipt: QuestionSourceImportReceipt,
    payloadHash: string
  ): Promise<ImportQuestionSourceResult> {
    if (receipt.payloadHash !== payloadHash) {
      throw new QuestionSourceImportConflictError(
        `Idempotency key ${receipt.idempotencyKey} was already used for different content`
      );
    }
    const source = await this.repository.findSource(receipt.sourceId);
    if (!source) throw new Error(`Question source import receipt ${receipt.id} has no source`);
    return {
      source,
      disposition: 'already_imported',
      importedQuestionCount: receipt.importedQuestionCount
    };
  }

  private async saveReceipt(
    source: QuestionSourceRecord,
    command: NormalizedImportCommand
  ): Promise<void> {
    const receipt = this.createReceipt(source, command, this.clock.now());
    try {
      await this.unitOfWork.run(async (context) => {
        await this.repository.saveImportReceipt(receipt, context);
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const existing = await this.repository.findImportReceipt(command.idempotencyKey);
      if (!existing || existing.sourceId !== source.id || existing.payloadHash !== command.contentHash) {
        throw error;
      }
    }
  }

  private createReceipt(
    source: QuestionSourceRecord,
    command: NormalizedImportCommand,
    createdAt: InstantMs
  ): QuestionSourceImportReceipt {
    return {
      id: this.ids.next('QuestionSourceImportReceiptId'),
      idempotencyKey: command.idempotencyKey,
      sourceId: source.id,
      payloadHash: command.contentHash,
      importedQuestionCount: command.links.length,
      createdAt
    };
  }
}

interface NormalizedImportSourceLink {
  readonly questionId: QuestionId;
  readonly sourceSequence?: number;
  readonly materialGroupKey?: string;
  readonly relationRole: QuestionSourceRelationRole;
  readonly calibrationRole: QuestionCalibrationRole;
}

interface NormalizedImportLineage {
  readonly questionId: QuestionId;
  readonly parentQuestionId: QuestionId;
  readonly derivationType: QuestionDerivationType;
  readonly generationWorkflowId?: WorkflowId;
  readonly referenceSnapshot: JsonObject;
}

interface NormalizedImportCommand extends Omit<ImportQuestionSourceCommand, 'links' | 'lineages' | 'sourceVersion'> {
  readonly sourceVersion: string;
  readonly links: readonly NormalizedImportSourceLink[];
  readonly lineages: readonly NormalizedImportLineage[];
}

function normalizeCommand(command: ImportQuestionSourceCommand): NormalizedImportCommand {
  const idempotencyKey = command.idempotencyKey.trim();
  if (!idempotencyKey) throw new TypeError('Question source idempotencyKey is required');
  const contentHash = command.contentHash.trim();
  if (contentHash.length < 16) throw new TypeError('Question source contentHash must be at least 16 characters');
  const sourceVersion = command.sourceVersion?.trim() || '1';
  const links = command.links.map((link) => ({
    ...link,
    materialGroupKey: optionalText(link.materialGroupKey),
    relationRole: link.relationRole ?? QuestionSourceRelationRole.Original,
    calibrationRole: link.calibrationRole ?? QuestionCalibrationRole.None
  }));
  if (requiresOriginalQuestions(command.sourceType) && !links.some((link) => (
    link.relationRole === QuestionSourceRelationRole.Original
  ))) {
    throw new TypeError('Imported and official sources require at least one original question link');
  }
  validateLinks(links);
  const lineages = (command.lineages ?? []).map((lineage) => ({
    ...lineage,
    referenceSnapshot: lineage.referenceSnapshot ?? {}
  }));
  validateLineages(lineages);
  if (command.sourceType === QuestionOriginType.AiVariant && lineages.length === 0) {
    throw new TypeError('AI variant sources require question lineage');
  }
  const paperName = optionalText(command.paperName);
  if (command.sourceType === QuestionOriginType.Official && (!paperName || command.examYear === undefined)) {
    throw new TypeError('Official sources require examYear and paperName');
  }
  if (command.examYear !== undefined && (!Number.isInteger(command.examYear) || command.examYear < 1990 || command.examYear > 2200)) {
    throw new RangeError('Question source examYear is out of range');
  }
  return {
    ...command,
    idempotencyKey,
    provider: optionalText(command.provider),
    examType: optionalText(command.examType),
    province: optionalText(command.province),
    examBatch: optionalText(command.examBatch),
    paperName,
    sectionName: optionalText(command.sectionName),
    contentHash,
    sourceVersion,
    links,
    lineages
  };
}

function resolveMatchingSource(
  sameIdentity: QuestionSourceRecord | undefined,
  sameContent: QuestionSourceRecord | undefined,
  identityHash: string,
  contentHash: string
): QuestionSourceRecord {
  if (sameIdentity && sameIdentity.contentHash !== contentHash) {
    throw new QuestionSourceImportConflictError(
      'The same question source identity already exists with different content; use a new sourceVersion'
    );
  }
  if (sameContent && sameContent.identityHash !== identityHash) {
    throw new QuestionSourceImportConflictError(
      'The same question source content already exists with different provenance metadata'
    );
  }
  const source = sameIdentity ?? sameContent;
  if (!source) throw new Error('Matching question source was not found');
  return source;
}

function validateLinks(links: NormalizedImportCommand['links']): void {
  const identities = new Set<string>();
  const sequences = new Set<string>();
  for (const link of links) {
    if (link.sourceSequence !== undefined && (
      !Number.isInteger(link.sourceSequence) || link.sourceSequence < 1
    )) {
      throw new RangeError('Question source sequence must be a positive integer');
    }
    const identity = `${link.questionId}:${link.relationRole}`;
    if (identities.has(identity)) throw new TypeError(`Duplicate question source link ${identity}`);
    identities.add(identity);
    if (link.sourceSequence !== undefined) {
      const sequence = `${link.relationRole}:${link.sourceSequence}`;
      if (sequences.has(sequence)) throw new TypeError(`Duplicate question source sequence ${sequence}`);
      sequences.add(sequence);
    }
  }
}

function validateLineages(lineages: NormalizedImportCommand['lineages']): void {
  const questions = new Set<QuestionId>();
  for (const lineage of lineages) {
    if (lineage.questionId === lineage.parentQuestionId) {
      throw new TypeError('Question lineage cannot reference itself');
    }
    if (questions.has(lineage.questionId)) {
      throw new TypeError(`Duplicate question lineage ${lineage.questionId}`);
    }
    questions.add(lineage.questionId);
  }
}

function requiresOriginalQuestions(sourceType: QuestionOriginType): boolean {
  return sourceType === QuestionOriginType.Official || sourceType === QuestionOriginType.Imported;
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

function isUniqueConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ConstraintError'
    || /UNIQUE constraint failed|Key already exists|already exists in the object store/i.test(error.message);
}
