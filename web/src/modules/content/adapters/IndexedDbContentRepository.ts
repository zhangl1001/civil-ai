import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import {
  TutorIndexedDb,
  TutorIndexedDbStore
} from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { ExamCycleId, GenerationSpecId, QuestionSetId } from '@/kernel/public';
import type {
  CommittedQuestionSetBundle,
  ContentMetadataBundle,
  ContentRepository,
  ContentSchemaVersion,
  QuestionSetLibraryEntry,
  QuestionSetLibraryQuery,
  QuestionSetEnrichmentPatch,
  QuestionTemplateVersion
} from '../contracts/ContentRepository';
import type { QuestionSourceRecord } from '../contracts/QuestionSourceRepository';
import {
  PublishedAssetStatus,
  QuestionSetPracticeStatus,
  QuestionSetStatus,
  type QuestionTemplateCode
} from '../domain/ContentCodes';
import { assertCommittedQuestionSetBundle, assertQuestionSetQueryLimit } from '../domain/ContentBundlePolicy';
import { resolveQuestionSetEntryMode } from '../domain/QuestionSetEntryModePolicy';
import {
  QuestionCalibrationRole,
  QuestionOriginType
} from '../domain/QuestionSourceCodes';

interface StoredContentMetadataBundle {
  readonly releaseId: string;
  readonly contentHash: string;
  readonly bundle: ContentMetadataBundle;
}

interface StoredQuestionSetBundle {
  readonly questionSetId: string;
  readonly examCycleId: string;
  readonly createdAt: number;
  readonly bundle: CommittedQuestionSetBundle;
}

export class IndexedDbContentRepository implements ContentRepository {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly transactionScope: IndexedDbTransactionScope
  ) {}

  async installMetadata(bundle: ContentMetadataBundle, context: TransactionContext): Promise<void> {
    this.transactionScope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.ContentMetadataBundles,
      value: {
        releaseId: bundle.releaseId,
        contentHash: bundle.contentHash,
        bundle
      } satisfies StoredContentMetadataBundle
    });
  }

  async findMetadata(releaseId: string): Promise<ContentMetadataBundle | undefined> {
    const stored = await this.database.get<StoredContentMetadataBundle>(
      TutorIndexedDbStore.ContentMetadataBundles,
      releaseId
    );
    return stored?.bundle;
  }

  async findPublishedSchema(schemaCode: string): Promise<ContentSchemaVersion | undefined> {
    const releases = await this.database.getAll<StoredContentMetadataBundle>(TutorIndexedDbStore.ContentMetadataBundles);
    return releases
      .flatMap((release) => release.bundle.schemaVersions)
      .filter((schema) => schema.schemaCode === schemaCode && schema.status === PublishedAssetStatus.Published)
      .sort(compareVersionsDescending)[0];
  }

  async findPublishedQuestionTemplate(templateCode: QuestionTemplateCode): Promise<QuestionTemplateVersion | undefined> {
    const releases = await this.database.getAll<StoredContentMetadataBundle>(TutorIndexedDbStore.ContentMetadataBundles);
    return releases
      .flatMap((release) => release.bundle.questionTemplateVersions)
      .filter((template) => template.templateCode === templateCode && template.status === PublishedAssetStatus.Published)
      .sort(compareVersionsDescending)[0];
  }

  async commitQuestionSet(bundle: CommittedQuestionSetBundle, context: TransactionContext): Promise<void> {
    assertCommittedQuestionSetBundle(bundle);
    this.transactionScope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.ContentQuestionSetBundles,
      value: {
        questionSetId: bundle.questionSet.id,
        examCycleId: bundle.questionSet.examCycleId,
        createdAt: bundle.questionSet.createdAt,
        bundle
      } satisfies StoredQuestionSetBundle
    });
  }

  async findQuestionSet(questionSetId: QuestionSetId): Promise<CommittedQuestionSetBundle | undefined> {
    const stored = await this.database.get<StoredQuestionSetBundle>(
      TutorIndexedDbStore.ContentQuestionSetBundles,
      questionSetId
    );
    return stored ? normalizedBundle(stored.bundle) : undefined;
  }

  async findQuestionSetByGenerationSpec(
    generationSpecId: GenerationSpecId
  ): Promise<CommittedQuestionSetBundle | undefined> {
    const stored = await this.database.getAll<StoredQuestionSetBundle>(TutorIndexedDbStore.ContentQuestionSetBundles);
    return stored
      .filter((item) => item.bundle.generationSpec.id === generationSpecId)
      .sort((left, right) => right.createdAt - left.createdAt || right.questionSetId.localeCompare(left.questionSetId))
      .map((item) => normalizedBundle(item.bundle))[0];
  }

  async listQuestionSetLibrary(
    examCycleId: ExamCycleId,
    limit: number
  ): Promise<readonly QuestionSetLibraryEntry[]> {
    return this.queryQuestionSetLibrary({ examCycleId, limit });
  }

  async queryQuestionSetLibrary(
    query: QuestionSetLibraryQuery
  ): Promise<readonly QuestionSetLibraryEntry[]> {
    const { examCycleId, limit } = query;
    assertQuestionSetQueryLimit(limit);
    const [stored, sources] = await Promise.all([
      this.database.getAll<StoredQuestionSetBundle>(TutorIndexedDbStore.ContentQuestionSetBundles),
      this.database.getAll<QuestionSourceRecord>(TutorIndexedDbStore.QuestionSources)
    ]);
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    return stored
      .filter((item) => (
        item.examCycleId === examCycleId
        && item.bundle.questionSet.status === QuestionSetStatus.Ready
      ))
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((item) => {
        const bundle = normalizedBundle(item.bundle);
        return libraryEntry(bundle, bundle.questionSet.sourceId
          ? sourceById.get(bundle.questionSet.sourceId)
          : undefined);
      })
      .filter((entry) => matchesLibraryQuery(entry, query))
      .filter((entry) => isBeforeCursor(entry, query.cursor))
      .slice(0, limit);
  }

  async listQuestionSets(examCycleId: ExamCycleId, limit: number): Promise<readonly CommittedQuestionSetBundle[]> {
    assertQuestionSetQueryLimit(limit);
    const stored = await this.database.getAll<StoredQuestionSetBundle>(TutorIndexedDbStore.ContentQuestionSetBundles);
    return stored
      .filter((item) => (
        item.examCycleId === examCycleId
        && item.bundle.questionSet.status === QuestionSetStatus.Ready
      ))
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit)
      .map((item) => normalizedBundle(item.bundle));
  }

  async listAllQuestionSets(examCycleId: ExamCycleId): Promise<readonly CommittedQuestionSetBundle[]> {
    const stored = await this.database.getAll<StoredQuestionSetBundle>(TutorIndexedDbStore.ContentQuestionSetBundles);
    return stored
      .filter((item) => (
        item.examCycleId === examCycleId
        && (
          item.bundle.questionSet.status === QuestionSetStatus.Ready
          || item.bundle.questionSet.status === QuestionSetStatus.Retired
        )
      ))
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((item) => normalizedBundle(item.bundle));
  }

  async updateQuestionSetPracticeStatus(
    questionSetId: QuestionSetId,
    status: QuestionSetPracticeStatus,
    context: TransactionContext
  ): Promise<void> {
    if (status === QuestionSetPracticeStatus.NotStarted) return;
    const stored = await this.database.get<StoredQuestionSetBundle>(
      TutorIndexedDbStore.ContentQuestionSetBundles,
      questionSetId
    );
    if (!stored) return;
    const bundle = normalizedBundle(stored.bundle);
    if (
      bundle.questionSet.practiceStatus === QuestionSetPracticeStatus.Completed
      || bundle.questionSet.practiceStatus === status
    ) return;
    this.transactionScope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.ContentQuestionSetBundles,
      value: {
        ...stored,
        bundle: {
          ...bundle,
          questionSet: { ...bundle.questionSet, practiceStatus: status }
        }
      } satisfies StoredQuestionSetBundle
    });
  }

  async retireQuestionSet(questionSetId: QuestionSetId, context: TransactionContext): Promise<void> {
    const stored = await this.database.get<StoredQuestionSetBundle>(
      TutorIndexedDbStore.ContentQuestionSetBundles,
      questionSetId
    );
    if (!stored) return;
    const bundle = normalizedBundle(stored.bundle);
    if (bundle.questionSet.status !== QuestionSetStatus.Ready) return;
    this.transactionScope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.ContentQuestionSetBundles,
      value: {
        ...stored,
        bundle: {
          ...bundle,
          questionSet: { ...bundle.questionSet, status: QuestionSetStatus.Retired }
        }
      } satisfies StoredQuestionSetBundle
    });
  }

  async applyQuestionSetEnrichment(
    patch: QuestionSetEnrichmentPatch,
    context: TransactionContext
  ): Promise<boolean> {
    const stored = await this.database.get<StoredQuestionSetBundle>(
      TutorIndexedDbStore.ContentQuestionSetBundles,
      patch.questionSetId
    );
    if (!stored) return false;
    const current = normalizedBundle(stored.bundle);
    if (
      current.questionSet.status !== QuestionSetStatus.Ready
      || current.questionSet.contentVersion !== patch.expectedContentVersion
    ) return false;

    const questionPatches = new Map(patch.questions.map((question) => [question.id, question]));
    const documentPatches = patch.lecture
      ? new Map([[patch.lecture.document.id, patch.lecture.document]])
      : new Map();
    this.transactionScope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.ContentQuestionSetBundles,
      value: {
        ...stored,
        bundle: {
          ...current,
          documents: current.documents.map((document) => documentPatches.get(document.id) ?? document),
          lectures: current.lectures.map((lecture) => (
            patch.lecture?.lectureId === lecture.id
              ? { ...lecture, version: lecture.version + 1 }
              : lecture
          )),
          questions: current.questions.map((question) => questionPatches.get(question.id) ?? question),
          questionSet: {
            ...current.questionSet,
            contentHash: patch.nextContentHash,
            contentVersion: current.questionSet.contentVersion + 1
          }
        }
      } satisfies StoredQuestionSetBundle
    });
    return true;
  }
}

function compareVersionsDescending(left: { readonly version: string }, right: { readonly version: string }): number {
  return right.version.localeCompare(left.version, undefined, { numeric: true });
}

function libraryEntry(
  bundle: CommittedQuestionSetBundle,
  sourceMetadata?: QuestionSourceRecord
): QuestionSetLibraryEntry {
  const entryMode = resolveQuestionSetEntryMode(bundle.generationSpec.constraints);
  const source = typeof bundle.generationSpec.constraints.source === 'string'
    ? bundle.generationSpec.constraints.source
    : undefined;
  return {
    id: bundle.questionSet.id,
    examCycleId: bundle.questionSet.examCycleId,
    learningThreadId: bundle.questionSet.learningThreadId,
    capabilityNodeId: bundle.questionSet.capabilityNodeId,
    purpose: bundle.questionSet.purpose,
    assessmentRole: bundle.questionSet.assessmentRole,
    module: bundle.questionSet.module,
    questionCount: bundle.questionSet.questionCount,
    practiceStatus: bundle.questionSet.practiceStatus,
    entryMode,
    source,
    originType: bundle.questionSet.originType,
    sourceId: bundle.questionSet.sourceId,
    sourceMetadata: sourceMetadata?.status === 'active' ? {
      sourceType: sourceMetadata.sourceType,
      provider: sourceMetadata.provider,
      examType: sourceMetadata.examType,
      examYear: sourceMetadata.examYear,
      province: sourceMetadata.province,
      examBatch: sourceMetadata.examBatch,
      paperName: sourceMetadata.paperName,
      sectionName: sourceMetadata.sectionName
    } : undefined,
    createdAt: bundle.questionSet.createdAt
  };
}

function matchesLibraryQuery(entry: QuestionSetLibraryEntry, query: QuestionSetLibraryQuery): boolean {
  return matches(query.capabilityNodeIds, entry.capabilityNodeId)
    && matches(query.originTypes, entry.originType)
    && matches(query.entryModes, entry.entryMode)
    && matches(query.modules, entry.module)
    && matches(query.practiceStatuses, entry.practiceStatus)
    && matches(query.examYears, entry.sourceMetadata?.examYear)
    && matches(query.provinces, entry.sourceMetadata?.province);
}

function isBeforeCursor(entry: QuestionSetLibraryEntry, cursor: QuestionSetLibraryQuery['cursor']): boolean {
  return !cursor
    || entry.createdAt < cursor.createdAt
    || (entry.createdAt === cursor.createdAt && entry.id < cursor.id);
}

function matches<T extends string | number>(accepted: readonly T[] | undefined, value: T | undefined): boolean {
  return !accepted?.length || (value !== undefined && accepted.includes(value));
}

function normalizedBundle(bundle: CommittedQuestionSetBundle): CommittedQuestionSetBundle {
  return {
    ...bundle,
    questionSet: {
      ...bundle.questionSet,
      practiceStatus: bundle.questionSet.practiceStatus ?? QuestionSetPracticeStatus.NotStarted,
      originType: bundle.questionSet.originType ?? QuestionOriginType.AiGenerated,
      calibrationRole: bundle.questionSet.calibrationRole ?? QuestionCalibrationRole.None
    },
    questions: bundle.questions.map((question) => ({
      ...question,
      originType: question.originType ?? QuestionOriginType.AiGenerated,
      calibrationRole: question.calibrationRole ?? QuestionCalibrationRole.None,
      isOfficial: question.isOfficial ?? false
    }))
  };
}
