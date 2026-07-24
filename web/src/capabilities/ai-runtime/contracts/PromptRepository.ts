import type { TransactionContext } from '@/capabilities/database/public';
import type { PromptBundle } from '../prompt/PromptContracts';
import type { PromptVersionId } from '@/kernel/public';

export interface PromptRepository {
  install(bundle: PromptBundle, context: TransactionContext): Promise<void>;
  find(promptCode: string, version: string): Promise<PromptBundle | undefined>;
  findById(versionId: PromptVersionId): Promise<PromptBundle | undefined>;
}
