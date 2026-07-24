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
  QuestionTemplateVersion
} from '../contracts/ContentRepository';
import { PublishedAssetStatus, QuestionSetStatus, type QuestionTemplateCode } from '../domain/ContentCodes';
import { assertCommittedQuestionSetBundle, assertQuestionSetQueryLimit } from '../domain/ContentBundlePolicy';

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
    return stored?.bundle;
  }

  async findQuestionSetByGenerationSpec(
    generationSpecId: GenerationSpecId
  ): Promise<CommittedQuestionSetBundle | undefined> {
    const stored = await this.database.getAll<StoredQuestionSetBundle>(TutorIndexedDbStore.ContentQuestionSetBundles);
    return stored
      .filter((item) => item.bundle.generationSpec.id === generationSpecId)
      .sort((left, right) => right.createdAt - left.createdAt)[0]?.bundle;
  }

  async listQuestionSets(examCycleId: ExamCycleId, limit: number): Promise<readonly CommittedQuestionSetBundle[]> {
    assertQuestionSetQueryLimit(limit);
    const stored = await this.database.getAll<StoredQuestionSetBundle>(TutorIndexedDbStore.ContentQuestionSetBundles);
    return stored
      .filter((item) => item.examCycleId === examCycleId && item.bundle.questionSet.status === QuestionSetStatus.Ready)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit)
      .map((item) => item.bundle);
  }
}

function compareVersionsDescending(left: { readonly version: string }, right: { readonly version: string }): number {
  return right.version.localeCompare(left.version, undefined, { numeric: true });
}
