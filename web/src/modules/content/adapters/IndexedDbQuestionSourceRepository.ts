import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import {
  TutorIndexedDb,
  TutorIndexedDbStore
} from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type {
  InstantMs,
  QuestionId,
  QuestionSourceId
} from '@/kernel/public';
import type { CommittedQuestionSetBundle } from '../contracts/ContentRepository';
import type {
  QuestionLineageRecord,
  QuestionProvenanceView,
  QuestionSourceImportBundle,
  QuestionSourceImportReceipt,
  QuestionSourceLinkRecord,
  QuestionSourceRecord,
  QuestionSourceRepository
} from '../contracts/QuestionSourceRepository';
import {
  QuestionOriginType,
  QuestionSourceRelationRole,
  QuestionSourceStatus
} from '../domain/QuestionSourceCodes';

interface StoredQuestionSetBundle {
  readonly questionSetId: string;
  readonly examCycleId: string;
  readonly createdAt: number;
  readonly bundle: CommittedQuestionSetBundle;
}

export class IndexedDbQuestionSourceRepository implements QuestionSourceRepository {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly scope: IndexedDbTransactionScope
  ) {}

  findSource(sourceId: QuestionSourceId): Promise<QuestionSourceRecord | undefined> {
    return this.database.get<QuestionSourceRecord>(TutorIndexedDbStore.QuestionSources, sourceId);
  }

  async findSourceByIdentityHash(identityHash: string): Promise<QuestionSourceRecord | undefined> {
    return (await this.database.getAllByIndex<QuestionSourceRecord>(
      TutorIndexedDbStore.QuestionSources,
      'by_identity_hash',
      identityHash
    ))[0];
  }

  async findSourceByContentHash(contentHash: string): Promise<QuestionSourceRecord | undefined> {
    return (await this.database.getAllByIndex<QuestionSourceRecord>(
      TutorIndexedDbStore.QuestionSources,
      'by_content_hash',
      contentHash
    ))[0];
  }

  async findImportReceipt(idempotencyKey: string): Promise<QuestionSourceImportReceipt | undefined> {
    return (await this.database.getAllByIndex<QuestionSourceImportReceipt>(
      TutorIndexedDbStore.QuestionSourceImportReceipts,
      'by_idempotency_key',
      idempotencyKey
    ))[0];
  }

  async findQuestionProvenance(questionId: QuestionId): Promise<QuestionProvenanceView> {
    const links = [...await this.database.getAllByIndex<QuestionSourceLinkRecord>(
      TutorIndexedDbStore.QuestionSourceLinks,
      'by_question',
      questionId
    )].sort(compareLinks);
    const lineage = (await this.database.getAllByIndex<QuestionLineageRecord>(
      TutorIndexedDbStore.QuestionLineages,
      'by_question',
      questionId
    ))[0];
    return {
      source: links[0] ? await this.findSource(links[0].sourceId) : undefined,
      links,
      lineage
    };
  }

  async listSourceLinks(
    sourceId: QuestionSourceId,
    limit: number
  ): Promise<readonly QuestionSourceLinkRecord[]> {
    assertQueryLimit(limit);
    return [...await this.database.getAllByIndex<QuestionSourceLinkRecord>(
      TutorIndexedDbStore.QuestionSourceLinks,
      'by_source',
      sourceId
    )].sort(compareSourceSequence).slice(0, limit);
  }

  async saveImport(bundle: QuestionSourceImportBundle, context: TransactionContext): Promise<void> {
    this.scope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.QuestionSources,
      value: bundle.source
    });
    bundle.links.forEach((link) => {
      this.scope.stage(context, {
        type: 'add',
        store: TutorIndexedDbStore.QuestionSourceLinks,
        value: link
      });
    });
    bundle.lineages.forEach((lineage) => {
      this.scope.stage(context, {
        type: 'add',
        store: TutorIndexedDbStore.QuestionLineages,
        value: lineage
      });
    });
    this.scope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.QuestionSourceImportReceipts,
      value: bundle.receipt
    });
    await this.stageQuestionProjections(bundle, context);
  }

  async saveLineages(
    lineages: readonly QuestionLineageRecord[],
    context: TransactionContext
  ): Promise<void> {
    lineages.forEach((lineage) => {
      this.scope.stage(context, {
        type: 'add',
        store: TutorIndexedDbStore.QuestionLineages,
        value: lineage
      });
    });
  }

  async saveImportReceipt(
    receipt: QuestionSourceImportReceipt,
    context: TransactionContext
  ): Promise<void> {
    this.scope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.QuestionSourceImportReceipts,
      value: receipt
    });
  }

  async archiveSource(
    sourceId: QuestionSourceId,
    updatedAt: InstantMs,
    context: TransactionContext
  ): Promise<void> {
    const source = await this.findSource(sourceId);
    if (!source || source.status !== QuestionSourceStatus.Active) return;
    this.scope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.QuestionSources,
      value: {
        ...source,
        status: QuestionSourceStatus.Archived,
        updatedAt
      }
    });
  }

  private async stageQuestionProjections(
    bundle: QuestionSourceImportBundle,
    context: TransactionContext
  ): Promise<void> {
    const originalLinks = new Map(
      bundle.links
        .filter((link) => link.relationRole === QuestionSourceRelationRole.Original)
        .map((link) => [link.questionId, link])
    );
    const lineages = new Map(bundle.lineages.map((lineage) => [lineage.questionId, lineage]));
    if (!originalLinks.size && !lineages.size) return;

    const stored = await this.database.getAll<StoredQuestionSetBundle>(
      TutorIndexedDbStore.ContentQuestionSetBundles
    );
    stored.forEach((item) => {
      let changed = false;
      const questions = item.bundle.questions.map((question) => {
        const link = originalLinks.get(question.id);
        const lineage = lineages.get(question.id);
        if (!link && !lineage) return question;
        changed = true;
        return {
          ...question,
          originType: link?.relationRole === QuestionSourceRelationRole.Original
            ? bundle.source.sourceType
            : question.originType,
          sourceId: link?.sourceId ?? question.sourceId,
          sourceSequence: link?.sourceSequence ?? question.sourceSequence,
          calibrationRole: link?.calibrationRole ?? question.calibrationRole,
          isOfficial: link
            ? bundle.source.sourceType === QuestionOriginType.Official
            : question.isOfficial,
          lineageId: lineage?.id ?? question.lineageId
        };
      });
      if (!changed) return;
      const homogeneous = questions.every((question) => question.sourceId === bundle.source.id);
      this.scope.stage(context, {
        type: 'put',
        store: TutorIndexedDbStore.ContentQuestionSetBundles,
        value: {
          ...item,
          bundle: {
            ...item.bundle,
            questionSet: homogeneous
              ? {
                  ...item.bundle.questionSet,
                  originType: bundle.source.sourceType,
                  sourceId: bundle.source.id,
                  calibrationRole: questions[0]?.calibrationRole
                }
              : item.bundle.questionSet,
            questions
          }
        } satisfies StoredQuestionSetBundle
      });
    });
  }
}

function compareLinks(left: QuestionSourceLinkRecord, right: QuestionSourceLinkRecord): number {
  return relationRank(left.relationRole) - relationRank(right.relationRole)
    || left.createdAt - right.createdAt
    || left.id.localeCompare(right.id);
}

function compareSourceSequence(left: QuestionSourceLinkRecord, right: QuestionSourceLinkRecord): number {
  return (left.sourceSequence ?? Number.MAX_SAFE_INTEGER) - (right.sourceSequence ?? Number.MAX_SAFE_INTEGER)
    || left.createdAt - right.createdAt
    || left.id.localeCompare(right.id);
}

function relationRank(role: QuestionSourceLinkRecord['relationRole']): number {
  if (role === QuestionSourceRelationRole.Original) return 0;
  if (role === QuestionSourceRelationRole.Reference) return 1;
  return 2;
}

function assertQueryLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('Question source query limit must be between 1 and 500');
  }
}
