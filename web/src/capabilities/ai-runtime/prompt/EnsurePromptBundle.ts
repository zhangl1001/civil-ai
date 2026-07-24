import type { UnitOfWork } from '@/capabilities/database/public';
import type { PromptRepository } from '../contracts/PromptRepository';
import type { PromptBundle } from './PromptContracts';

export class EnsurePromptBundle {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: PromptRepository
  ) {}

  async execute(bundle: PromptBundle): Promise<void> {
    const existing = await this.repository.find(bundle.promptCode, bundle.version);
    if (existing) {
      assertSamePrompt(existing, bundle);
      return;
    }
    try {
      await this.unitOfWork.run((context) => this.repository.install(bundle, context));
    } catch (error) {
      const concurrentInstall = await this.repository.find(bundle.promptCode, bundle.version);
      if (!concurrentInstall) throw error;
      assertSamePrompt(concurrentInstall, bundle);
    }
  }
}

function assertSamePrompt(installed: PromptBundle, bundled: PromptBundle): void {
  if (installed.contentHash !== bundled.contentHash) {
    throw new Error(`Prompt ${bundled.promptCode}@${bundled.version} has different content`);
  }
}
