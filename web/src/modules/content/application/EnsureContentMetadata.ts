import type { UnitOfWork } from '@/capabilities/database/public';
import type { ContentMetadataBundle, ContentRepository } from '../contracts/ContentRepository';

export class EnsureContentMetadata {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: ContentRepository
  ) {}

  async execute(bundle: ContentMetadataBundle): Promise<void> {
    const existing = await this.repository.findMetadata(bundle.releaseId);
    if (existing) {
      this.assertSameRelease(existing, bundle);
      return;
    }
    try {
      await this.unitOfWork.run((context) => this.repository.installMetadata(bundle, context));
    } catch (error) {
      const concurrentInstall = await this.repository.findMetadata(bundle.releaseId);
      if (!concurrentInstall) throw error;
      this.assertSameRelease(concurrentInstall, bundle);
    }
  }

  private assertSameRelease(installed: ContentMetadataBundle, bundled: ContentMetadataBundle): void {
    if (installed.contentHash !== bundled.contentHash) {
      throw new Error(`Content metadata ${bundled.releaseId} has the same ID but different content`);
    }
  }
}
