import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb, TutorIndexedDbStore } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { PromptVersionId } from '@/kernel/public';
import type { PromptRepository } from '../contracts/PromptRepository';
import type { PromptBundle } from '../prompt/PromptContracts';

interface StoredPromptBundle {
  readonly key: string;
  readonly promptCode: string;
  readonly version: string;
  readonly bundle: PromptBundle;
}

export class IndexedDbPromptRepository implements PromptRepository {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly transactionScope: IndexedDbTransactionScope
  ) {}

  async install(bundle: PromptBundle, context: TransactionContext): Promise<void> {
    this.transactionScope.stage(context, {
      type: 'add',
      store: TutorIndexedDbStore.PromptBundles,
      value: {
        key: promptKey(bundle.promptCode, bundle.version),
        promptCode: bundle.promptCode,
        version: bundle.version,
        bundle
      } satisfies StoredPromptBundle
    });
  }

  async find(promptCode: string, version: string): Promise<PromptBundle | undefined> {
    const stored = await this.database.get<StoredPromptBundle>(
      TutorIndexedDbStore.PromptBundles,
      promptKey(promptCode, version)
    );
    return stored?.bundle;
  }

  async findById(versionId: PromptVersionId): Promise<PromptBundle | undefined> {
    const records = await this.database.getAll<StoredPromptBundle>(TutorIndexedDbStore.PromptBundles);
    return records.find((record) => record.bundle.versionId === versionId)?.bundle;
  }
}

function promptKey(promptCode: string, version: string): string {
  return `${promptCode}@${version}`;
}
