import type { UnitOfWork } from '@/capabilities/database/public';
import type { CurriculumBundle, CurriculumRepository } from '../contracts/CurriculumRepository';

export class EnsureCurriculumBundle {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: CurriculumRepository
  ) {}

  async execute(bundle: CurriculumBundle): Promise<void> {
    const existing = await this.repository.findBundle(bundle.curriculum.id);
    if (existing) {
      this.assertSameRelease(existing, bundle);
      return;
    }

    try {
      await this.unitOfWork.run((context) => this.repository.installBundle(bundle, context));
    } catch (error) {
      const concurrentInstall = await this.repository.findBundle(bundle.curriculum.id);
      if (!concurrentInstall) throw error;
      this.assertSameRelease(concurrentInstall, bundle);
    }
  }

  private assertSameRelease(installed: CurriculumBundle, bundled: CurriculumBundle): void {
    if (
      installed.metadataPackage.contentHash !== bundled.metadataPackage.contentHash
      || installed.curriculum.contentHash !== bundled.curriculum.contentHash
    ) {
      throw new Error(
        `Published curriculum ${bundled.curriculum.id} has the same ID but different content`
      );
    }
  }
}
