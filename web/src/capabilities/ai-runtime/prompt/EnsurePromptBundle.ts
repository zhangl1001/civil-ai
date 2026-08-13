import type { UnitOfWork } from '@/capabilities/database/public';
import type { PromptRepository } from '../contracts/PromptRepository';
import type { PromptBundle } from './PromptContracts';

export const PromptBundleEnsureStatus = {
  Conflict: 'conflict',
  Installed: 'installed',
  Unchanged: 'unchanged'
} as const;

export type PromptBundleEnsureStatus = typeof PromptBundleEnsureStatus[keyof typeof PromptBundleEnsureStatus];

export class EnsurePromptBundle {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: PromptRepository
  ) {}

  async execute(bundle: PromptBundle): Promise<PromptBundleEnsureStatus> {
    const existing = await this.repository.find(bundle.examType, bundle.promptCode, bundle.version);
    if (existing) {
      return samePrompt(existing, bundle)
        ? PromptBundleEnsureStatus.Unchanged
        : reportConflict(existing, bundle);
    }
    try {
      await this.unitOfWork.run((context) => this.repository.install(bundle, context));
      return PromptBundleEnsureStatus.Installed;
    } catch (error) {
      const concurrentInstall = await this.repository.find(bundle.examType, bundle.promptCode, bundle.version);
      if (!concurrentInstall) throw error;
      return samePrompt(concurrentInstall, bundle)
        ? PromptBundleEnsureStatus.Unchanged
        : reportConflict(concurrentInstall, bundle);
    }
  }
}

function samePrompt(installed: PromptBundle, bundled: PromptBundle): boolean {
  return installed.contentHash === bundled.contentHash;
}

function reportConflict(installed: PromptBundle, bundled: PromptBundle): PromptBundleEnsureStatus {
  console.warn('[PromptMetadata] bundled prompt version conflicts with installed metadata', {
    examType: bundled.examType,
    promptCode: bundled.promptCode,
    version: bundled.version,
    bundledContentHash: bundled.contentHash,
    installedContentHash: installed.contentHash
  });
  return PromptBundleEnsureStatus.Conflict;
}
