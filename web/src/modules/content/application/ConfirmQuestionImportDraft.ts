import type { UnitOfWork } from '@/capabilities/database/public';
import { sha256Json, type Clock, type IdGenerator, type JsonObject, type JsonValue, type QuestionImportCandidateId, type QuestionImportDraftId } from '@/kernel/public';
import type {
  QuestionImportDraftAggregate,
  QuestionImportDraftRepository,
  QuestionImportSourceMetadata
} from '../contracts/QuestionImportDraftRepository';
import {
  QuestionImportCandidateStatus,
  QuestionImportDraftStatus
} from '../domain/QuestionImportCodes';
import { QuestionImportCandidateScanner } from './QuestionImportCandidateScanner';
import {
  sourceIssues,
  toQuestionImportDraftView,
  type QuestionImportDraftView
} from './ScanQuestionImportDraft';

export interface ConfirmQuestionImportDraftCommand {
  readonly draftId: QuestionImportDraftId;
  readonly expectedVersion: number;
  readonly sourceMetadata?: Partial<QuestionImportSourceMetadata>;
  readonly replacements?: readonly {
    readonly candidateId: QuestionImportCandidateId;
    readonly raw: JsonObject;
    readonly difficulty?: number;
  }[];
  readonly rejectedCandidateIds?: readonly QuestionImportCandidateId[];
}

export class ConfirmQuestionImportDraft {
  private readonly scanner: QuestionImportCandidateScanner;

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: QuestionImportDraftRepository,
    private readonly clock: Clock,
    ids: IdGenerator
  ) {
    this.scanner = new QuestionImportCandidateScanner(clock, ids);
  }

  async execute(command: ConfirmQuestionImportDraftCommand): Promise<QuestionImportDraftView> {
    const current = await this.repository.find(command.draftId);
    if (!current) throw new Error(`Question import draft ${command.draftId} was not found`);
    if (current.draft.version !== command.expectedVersion) throw new Error('Question import draft was changed concurrently');
    if (current.draft.status === QuestionImportDraftStatus.Published) return toQuestionImportDraftView(current);
    if (current.draft.status === QuestionImportDraftStatus.Rejected) throw new Error('Rejected question import draft cannot be confirmed');

    const replacementById = new Map((command.replacements ?? []).map((item) => [item.candidateId, item]));
    const rejected = new Set(command.rejectedCandidateIds ?? []);
    assertCandidateSelection(current, replacementById, rejected);
    const materialGroupUses = countMaterialGroupUses(current.candidates, replacementById);
    const candidates = await Promise.all(current.candidates.map(async (candidate) => {
      if (rejected.has(candidate.id)) {
        return {
          ...candidate,
          content: undefined,
          contentHash: undefined,
          status: QuestionImportCandidateStatus.Rejected,
          issues: [],
          updatedAt: this.clock.now()
        };
      }
      const replacement = replacementById.get(candidate.id);
      if (!replacement) return candidate;
      const materialGroupId = typeof replacement.raw.materialGroupId === 'string'
        ? replacement.raw.materialGroupId.trim()
        : undefined;
      return this.scanner.scan(current.draft.id, current.draft.capabilityCode, {
        candidateId: candidate.id,
        createdAt: candidate.createdAt,
        sequence: candidate.sequence,
        raw: replacement.raw,
        difficulty: replacement.difficulty ?? candidate.difficulty,
        preserveMaterialGroupId: Boolean(materialGroupId && (materialGroupUses.get(materialGroupId) ?? 0) >= 2)
      });
    }));
    const sourceMetadata = normalizeMetadata({
      ...current.draft.sourceMetadata,
      ...command.sourceMetadata,
      provenance: command.sourceMetadata?.provenance ?? current.draft.sourceMetadata.provenance
    });
    const draftIssues = sourceIssues(
      current.draft.sourceType,
      sourceMetadata,
      candidates.filter((candidate) => candidate.status !== QuestionImportCandidateStatus.Rejected).length
    );
    const canConfirm = draftIssues.length === 0
      && candidates.some((candidate) => candidate.status === QuestionImportCandidateStatus.Ready)
      && candidates.every((candidate) => (
        candidate.status === QuestionImportCandidateStatus.Ready
        || candidate.status === QuestionImportCandidateStatus.Rejected
      ));
    const now = this.clock.now();
    const rawPayloadHash = await sha256Json(toJson({
      sourceMetadata,
      candidates: candidates
        .filter((candidate) => candidate.status !== QuestionImportCandidateStatus.Rejected)
        .map((candidate) => candidate.raw)
    }));
    const next: QuestionImportDraftAggregate = {
      draft: {
        ...current.draft,
        sourceMetadata,
        rawPayloadHash,
        status: canConfirm
          ? QuestionImportDraftStatus.Confirmed
          : QuestionImportDraftStatus.NeedsConfirmation,
        issues: draftIssues,
        version: current.draft.version + 1,
        updatedAt: now
      },
      candidates
    };
    await this.unitOfWork.run((context) => (
      this.repository.replace(next, current.draft.version, context)
    ));
    return toQuestionImportDraftView(next);
  }
}

function countMaterialGroupUses(
  candidates: QuestionImportDraftAggregate['candidates'],
  replacements: ReadonlyMap<QuestionImportCandidateId, ConfirmQuestionImportDraftCommand['replacements'] extends readonly (infer Item)[] | undefined ? Item : never>
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const raw = replacements.get(candidate.id)?.raw ?? candidate.raw;
    if (typeof raw.materialGroupId !== 'string' || !raw.materialGroupId.trim()) continue;
    const id = raw.materialGroupId.trim();
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function assertCandidateSelection(
  aggregate: QuestionImportDraftAggregate,
  replacements: ReadonlyMap<QuestionImportCandidateId, unknown>,
  rejected: ReadonlySet<QuestionImportCandidateId>
): void {
  const known = new Set(aggregate.candidates.map((candidate) => candidate.id));
  for (const id of [...replacements.keys(), ...rejected]) {
    if (!known.has(id)) throw new Error(`Question import candidate ${id} does not belong to this draft`);
  }
  for (const id of replacements.keys()) {
    if (rejected.has(id)) throw new Error(`Question import candidate ${id} cannot be replaced and rejected together`);
  }
}

function normalizeMetadata(metadata: QuestionImportSourceMetadata): QuestionImportSourceMetadata {
  return {
    ...metadata,
    provider: optionalText(metadata.provider),
    examType: optionalText(metadata.examType),
    province: optionalText(metadata.province),
    examBatch: optionalText(metadata.examBatch),
    paperName: optionalText(metadata.paperName),
    sectionName: optionalText(metadata.sectionName),
    sourceVersion: optionalText(metadata.sourceVersion) ?? '1'
  };
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
