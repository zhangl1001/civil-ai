import type { UnitOfWork } from '@/capabilities/database/public';
import {
  sha256Json,
  type CapabilityNodeId,
  type Clock,
  type ExamCycleId,
  type IdGenerator,
  type JsonObject,
  type JsonValue
} from '@/kernel/public';
import type {
  QuestionImportDraftAggregate,
  QuestionImportDraftRepository,
  QuestionImportIssue,
  QuestionImportSourceMetadata
} from '../contracts/QuestionImportDraftRepository';
import {
  QuestionImportDraftStatus,
  QuestionImportIssueCode
} from '../domain/QuestionImportCodes';
import {
  QuestionImportMethod,
  QuestionOriginType
} from '../domain/QuestionSourceCodes';
import { QuestionImportCandidateScanner } from './QuestionImportCandidateScanner';

export interface ScanQuestionImportDraftCommand {
  readonly idempotencyKey: string;
  readonly examCycleId: ExamCycleId;
  readonly capabilityNodeId: CapabilityNodeId;
  readonly capabilityCode: string;
  readonly module: string;
  readonly ownerSessionId?: string;
  readonly sourceType: QuestionOriginType;
  readonly importMethod: QuestionImportMethod;
  readonly sourceMetadata: Omit<QuestionImportSourceMetadata, 'sourceVersion'> & {
    readonly sourceVersion?: string;
  };
  readonly materialGroups?: readonly {
    readonly id: string;
    readonly markdown: string;
  }[];
  readonly candidates: readonly {
    readonly raw: JsonObject;
    readonly difficulty?: number;
  }[];
}

export interface QuestionImportDraftView {
  readonly draftId: string;
  readonly status: QuestionImportDraftAggregate['draft']['status'];
  readonly totalCount: number;
  readonly readyCount: number;
  readonly needsConfirmationCount: number;
  readonly rejectedCount: number;
  readonly issues: readonly QuestionImportIssue[];
  readonly candidates: readonly {
    readonly candidateId: string;
    readonly sequence: number;
    readonly status: QuestionImportDraftAggregate['candidates'][number]['status'];
    readonly issues: readonly QuestionImportIssue[];
  }[];
  readonly version: number;
}

export class QuestionImportDraftConflictError extends Error {
  readonly code = 'content.question_import_draft_conflict';

  constructor(message: string) {
    super(message);
    this.name = 'QuestionImportDraftConflictError';
  }
}

export class ScanQuestionImportDraft {
  private readonly candidateScanner: QuestionImportCandidateScanner;

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: QuestionImportDraftRepository,
    clock: Clock,
    private readonly ids: IdGenerator
  ) {
    this.candidateScanner = new QuestionImportCandidateScanner(clock, ids);
    this.clock = clock;
  }

  private readonly clock: Clock;

  async execute(command: ScanQuestionImportDraftCommand): Promise<QuestionImportDraftView> {
    const normalized = normalizeCommand(command);
    const payloadHash = await sha256Json(toJson({
      examCycleId: normalized.examCycleId,
      capabilityNodeId: normalized.capabilityNodeId,
      capabilityCode: normalized.capabilityCode,
      module: normalized.module,
      ownerSessionId: normalized.ownerSessionId ?? null,
      sourceType: normalized.sourceType,
      importMethod: normalized.importMethod,
      sourceMetadata: normalized.sourceMetadata,
      materialGroups: normalized.materialGroups,
      candidates: normalized.candidates
    }));
    const existing = await this.repository.findByIdempotencyKey(normalized.idempotencyKey);
    if (existing) {
      if (existing.draft.rawPayloadHash !== payloadHash) {
        throw new QuestionImportDraftConflictError('Question import scan idempotency key was reused for different content');
      }
      return toView(existing);
    }

    const now = this.clock.now();
    const draftId = this.ids.next('QuestionImportDraftId');
    const materialGroups = new Map((normalized.materialGroups ?? []).map((group) => [group.id, group.markdown]));
    const materialGroupUses = countMaterialGroupUses(normalized.candidates);
    const candidates = await Promise.all(normalized.candidates.map((candidate, index) => {
      const materialGroupId = typeof candidate.raw.materialGroupId === 'string'
        ? candidate.raw.materialGroupId.trim()
        : undefined;
      const groupedMaterial = materialGroupId ? materialGroups.get(materialGroupId) : undefined;
      const raw = groupedMaterial
        ? { ...candidate.raw, material: groupedMaterial }
        : candidate.raw;
      const preflightIssues = materialGroupId && !groupedMaterial
        ? [{
            code: QuestionImportIssueCode.InvalidStructure,
            path: '$.materialGroupId',
            message: `Question references unknown material group ${materialGroupId}`
          }] as const
        : [];
      return (
      this.candidateScanner.scan(draftId, normalized.capabilityCode, {
        raw,
        sequence: index + 1,
        difficulty: candidate.difficulty,
        preserveMaterialGroupId: Boolean(materialGroupId && (materialGroupUses.get(materialGroupId) ?? 0) >= 2),
        preflightIssues
      })
      );
    }));
    const aggregate: QuestionImportDraftAggregate = {
      draft: {
        id: draftId,
        examCycleId: normalized.examCycleId,
        capabilityNodeId: normalized.capabilityNodeId,
        capabilityCode: normalized.capabilityCode,
        module: normalized.module,
        ownerSessionId: optionalText(normalized.ownerSessionId),
        sourceType: normalized.sourceType,
        importMethod: normalized.importMethod,
        sourceMetadata: normalized.sourceMetadata,
        rawPayloadHash: payloadHash,
        status: QuestionImportDraftStatus.NeedsConfirmation,
        issues: sourceIssues(normalized.sourceType, normalized.sourceMetadata, candidates.length),
        idempotencyKey: normalized.idempotencyKey,
        version: 1,
        createdAt: now,
        updatedAt: now
      },
      candidates
    };
    try {
      await this.unitOfWork.run((context) => this.repository.save(aggregate, context));
      return toView(aggregate);
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const concurrent = await this.repository.findByIdempotencyKey(normalized.idempotencyKey);
      if (!concurrent || concurrent.draft.rawPayloadHash !== payloadHash) throw error;
      return toView(concurrent);
    }
  }
}

interface NormalizedCommand extends ScanQuestionImportDraftCommand {
  readonly sourceMetadata: QuestionImportSourceMetadata;
}

function normalizeCommand(command: ScanQuestionImportDraftCommand): NormalizedCommand {
  const idempotencyKey = requiredText(command.idempotencyKey, 'Question import idempotencyKey');
  const capabilityCode = requiredText(command.capabilityCode, 'Question import capabilityCode');
  const module = requiredText(command.module, 'Question import module');
  if (!Object.values(QuestionOriginType).includes(command.sourceType)) throw new TypeError('Question import sourceType is invalid');
  if (!Object.values(QuestionImportMethod).includes(command.importMethod)) throw new TypeError('Question import importMethod is invalid');
  if (!Array.isArray(command.candidates) || command.candidates.length === 0 || command.candidates.length > 200) {
    throw new RangeError('Question import requires between 1 and 200 candidates');
  }
  const materialGroupIds = new Set<string>();
  for (const group of command.materialGroups ?? []) {
    const id = requiredText(group.id, 'Question import material group id');
    if (materialGroupIds.has(id)) throw new TypeError(`Duplicate question material group ${id}`);
    materialGroupIds.add(id);
    requiredText(group.markdown, `Question import material group ${id} content`);
  }
  return {
    ...command,
    idempotencyKey,
    capabilityCode,
    module,
    sourceMetadata: {
      ...command.sourceMetadata,
      provider: optionalText(command.sourceMetadata.provider),
      examType: optionalText(command.sourceMetadata.examType),
      province: optionalText(command.sourceMetadata.province),
      examBatch: optionalText(command.sourceMetadata.examBatch),
      paperName: optionalText(command.sourceMetadata.paperName),
      sectionName: optionalText(command.sourceMetadata.sectionName),
      sourceVersion: optionalText(command.sourceMetadata.sourceVersion) ?? '1'
    }
  };
}

function countMaterialGroupUses(
  candidates: ScanQuestionImportDraftCommand['candidates']
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    if (typeof candidate.raw.materialGroupId !== 'string' || !candidate.raw.materialGroupId.trim()) continue;
    const id = candidate.raw.materialGroupId.trim();
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export function sourceIssues(
  sourceType: QuestionOriginType,
  metadata: QuestionImportSourceMetadata,
  candidateCount: number
): readonly QuestionImportIssue[] {
  const issues: QuestionImportIssue[] = [];
  if (candidateCount === 0) {
    issues.push({
      code: QuestionImportIssueCode.InvalidStructure,
      path: '$.candidates',
      message: 'At least one question candidate is required'
    });
  }
  if (sourceType === QuestionOriginType.Official) {
    if (metadata.examYear === undefined) {
      issues.push({
        code: QuestionImportIssueCode.MissingSourceIdentity,
        path: '$.sourceMetadata.examYear',
        message: 'Official question source requires examYear'
      });
    }
    if (!metadata.paperName) {
      issues.push({
        code: QuestionImportIssueCode.MissingSourceIdentity,
        path: '$.sourceMetadata.paperName',
        message: 'Official question source requires paperName'
      });
    }
  }
  return issues;
}

export function toQuestionImportDraftView(aggregate: QuestionImportDraftAggregate): QuestionImportDraftView {
  return toView(aggregate);
}

function toView(aggregate: QuestionImportDraftAggregate): QuestionImportDraftView {
  return {
    draftId: aggregate.draft.id,
    status: aggregate.draft.status,
    totalCount: aggregate.candidates.length,
    readyCount: aggregate.candidates.filter((candidate) => candidate.status === 'ready').length,
    needsConfirmationCount: aggregate.candidates.filter((candidate) => candidate.status === 'needs_confirmation').length,
    rejectedCount: aggregate.candidates.filter((candidate) => candidate.status === 'rejected').length,
    issues: [
      ...aggregate.draft.issues,
      ...aggregate.candidates.flatMap((candidate) => candidate.issues)
    ],
    candidates: aggregate.candidates.map((candidate) => ({
      candidateId: candidate.id,
      sequence: candidate.sequence,
      status: candidate.status,
      issues: candidate.issues
    })),
    version: aggregate.draft.version
  };
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
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
