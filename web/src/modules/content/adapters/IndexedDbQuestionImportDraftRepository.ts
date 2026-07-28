import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import {
  TutorIndexedDb,
  TutorIndexedDbStore
} from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type {
  InstantMs,
  QuestionId,
  QuestionImportDraftId,
  QuestionSetId
} from '@/kernel/public';
import type {
  QuestionImportDraftAggregate,
  QuestionImportDraftRepository,
  QuestionImportPublishReceipt
} from '../contracts/QuestionImportDraftRepository';
import { QuestionImportCandidateStatus, QuestionImportDraftStatus } from '../domain/QuestionImportCodes';

export class IndexedDbQuestionImportDraftRepository implements QuestionImportDraftRepository {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly scope: IndexedDbTransactionScope
  ) {}

  async find(draftId: QuestionImportDraftId): Promise<QuestionImportDraftAggregate | undefined> {
    const draft = await this.database.get<QuestionImportDraftAggregate['draft']>(
      TutorIndexedDbStore.QuestionImportDrafts,
      draftId
    );
    if (!draft) return undefined;
    const candidates = await this.database.getAllByIndex<QuestionImportDraftAggregate['candidates'][number]>(
      TutorIndexedDbStore.QuestionImportCandidates,
      'by_draft',
      draftId
    );
    return { draft, candidates: [...candidates].sort((left, right) => left.sequence - right.sequence) };
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<QuestionImportDraftAggregate | undefined> {
    const drafts = await this.database.getAllByIndex<QuestionImportDraftAggregate['draft']>(
      TutorIndexedDbStore.QuestionImportDrafts,
      'by_idempotency_key',
      idempotencyKey
    );
    return drafts[0] ? this.find(drafts[0].id) : undefined;
  }

  async findLatestPendingByOwner(ownerSessionId: string): Promise<QuestionImportDraftAggregate | undefined> {
    const drafts = await this.database.getAllByIndex<QuestionImportDraftAggregate['draft']>(
      TutorIndexedDbStore.QuestionImportDrafts,
      'by_owner',
      ownerSessionId
    );
    const pending = drafts
      .filter((draft) => (
        draft.status === QuestionImportDraftStatus.NeedsConfirmation
        || draft.status === QuestionImportDraftStatus.Confirmed
      ))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    return pending ? this.find(pending.id) : undefined;
  }

  async findPublishReceipt(idempotencyKey: string): Promise<QuestionImportPublishReceipt | undefined> {
    const receipts = await this.database.getAllByIndex<QuestionImportPublishReceipt>(
      TutorIndexedDbStore.QuestionImportPublishReceipts,
      'by_idempotency_key',
      idempotencyKey
    );
    return receipts[0];
  }

  async save(aggregate: QuestionImportDraftAggregate, context: TransactionContext): Promise<void> {
    this.scope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.QuestionImportDrafts,
      value: aggregate.draft
    });
    for (const candidate of aggregate.candidates) {
      this.scope.stage(context, {
        type: 'add',
        store: TutorIndexedDbStore.QuestionImportCandidates,
        value: candidate
      });
    }
  }

  async replace(
    aggregate: QuestionImportDraftAggregate,
    expectedVersion: number,
    context: TransactionContext
  ): Promise<void> {
    const existing = await this.find(aggregate.draft.id);
    if (!existing || existing.draft.version !== expectedVersion || existing.draft.status === QuestionImportDraftStatus.Published) {
      throw new Error('Question import draft was changed concurrently');
    }
    for (const candidate of existing.candidates) {
      this.scope.stage(context, {
        type: 'delete',
        store: TutorIndexedDbStore.QuestionImportCandidates,
        key: candidate.id
      });
    }
    this.scope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.QuestionImportDrafts,
      value: aggregate.draft
    });
    for (const candidate of aggregate.candidates) {
      this.scope.stage(context, {
        type: 'add',
        store: TutorIndexedDbStore.QuestionImportCandidates,
        value: candidate
      });
    }
  }

  async markPublished(
    draftId: QuestionImportDraftId,
    expectedVersion: number,
    questionSetId: QuestionSetId,
    candidateQuestionIds: Readonly<Record<string, QuestionId>>,
    receipt: QuestionImportPublishReceipt,
    updatedAt: InstantMs,
    context: TransactionContext
  ): Promise<void> {
    const aggregate = await this.find(draftId);
    if (!aggregate || aggregate.draft.version !== expectedVersion || aggregate.draft.status !== QuestionImportDraftStatus.Confirmed) {
      throw new Error('Question import draft is not publishable');
    }
    const publishable = aggregate.candidates.filter((candidate) => candidate.status === QuestionImportCandidateStatus.Ready);
    if (publishable.length !== Object.keys(candidateQuestionIds).length) {
      throw new Error('Question import candidate mapping is incomplete');
    }
    this.scope.stage(context, {
      type: 'put',
      store: TutorIndexedDbStore.QuestionImportDrafts,
      value: {
        ...aggregate.draft,
        status: QuestionImportDraftStatus.Published,
        publishedQuestionSetId: questionSetId,
        version: aggregate.draft.version + 1,
        updatedAt
      }
    });
    for (const candidate of publishable) {
      const questionId = candidateQuestionIds[candidate.id];
      if (!questionId) throw new Error(`Question import candidate ${candidate.id} has no published question`);
      this.scope.stage(context, {
        type: 'put',
        store: TutorIndexedDbStore.QuestionImportCandidates,
        value: {
          ...candidate,
          status: QuestionImportCandidateStatus.Published,
          publishedQuestionId: questionId,
          updatedAt
        }
      });
    }
    this.scope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.QuestionImportPublishReceipts,
      value: receipt
    });
  }
}
