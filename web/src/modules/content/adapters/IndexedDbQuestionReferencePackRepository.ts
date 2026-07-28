import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import {
  TutorIndexedDb,
  TutorIndexedDbStore
} from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { QuestionReferencePackId } from '@/kernel/public';
import type {
  QuestionReferencePackRepository,
  TrueQuestionReferencePack
} from '../contracts/QuestionReferencePackRepository';

export class IndexedDbQuestionReferencePackRepository implements QuestionReferencePackRepository {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly scope: IndexedDbTransactionScope
  ) {}

  find(referencePackId: QuestionReferencePackId): Promise<TrueQuestionReferencePack | undefined> {
    return this.database.get<TrueQuestionReferencePack>(
      TutorIndexedDbStore.QuestionReferencePacks,
      referencePackId
    );
  }

  async findByContentHash(contentHash: string): Promise<TrueQuestionReferencePack | undefined> {
    return (await this.database.getAllByIndex<TrueQuestionReferencePack>(
      TutorIndexedDbStore.QuestionReferencePacks,
      'by_content_hash',
      contentHash
    ))[0];
  }

  async save(referencePack: TrueQuestionReferencePack, context: TransactionContext): Promise<void> {
    this.scope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.QuestionReferencePacks,
      value: referencePack
    });
  }
}
