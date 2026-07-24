import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import {
  TutorIndexedDb,
  TutorIndexedDbStore
} from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { CurriculumVersionId } from '@/kernel/public';
import type { CurriculumBundle, CurriculumRepository } from '../contracts/CurriculumRepository';

interface StoredCurriculumBundle {
  readonly curriculumVersionId: string;
  readonly metadataPackageId: string;
  readonly status: string;
  readonly bundle: CurriculumBundle;
}

export class IndexedDbCurriculumRepository implements CurriculumRepository {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly transactionScope: IndexedDbTransactionScope
  ) {}

  async installBundle(bundle: CurriculumBundle, context: TransactionContext): Promise<void> {
    this.transactionScope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.CurriculumBundles,
      value: {
        curriculumVersionId: bundle.curriculum.id,
        metadataPackageId: bundle.metadataPackage.id,
        status: bundle.curriculum.status,
        bundle
      } satisfies StoredCurriculumBundle
    });
  }

  async findBundle(curriculumVersionId: CurriculumVersionId): Promise<CurriculumBundle | undefined> {
    const stored = await this.database.get<StoredCurriculumBundle>(
      TutorIndexedDbStore.CurriculumBundles,
      curriculumVersionId
    );
    return stored?.bundle;
  }
}
