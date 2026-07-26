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
      if (!this.isSameRelease(existing, bundle)) {
        await this.unitOfWork.run((context) => this.repository.synchronizeBundle(bundle, context));
      }
      return;
    }

    try {
      await this.unitOfWork.run((context) => this.repository.installBundle(bundle, context));
    } catch (error) {
      const concurrentInstall = await this.repository.findBundle(bundle.curriculum.id);
      if (!concurrentInstall) throw error;
      if (!this.isSameRelease(concurrentInstall, bundle)) {
        await this.unitOfWork.run((context) => this.repository.synchronizeBundle(bundle, context));
      }
    }
  }

  private isSameRelease(installed: CurriculumBundle, bundled: CurriculumBundle): boolean {
    return installed.metadataPackage.contentHash === bundled.metadataPackage.contentHash
      && installed.curriculum.contentHash === bundled.curriculum.contentHash
      && sameValues(installed.capabilityNodes.map((node) => node.id), bundled.capabilityNodes.map((node) => node.id))
      && sameValues(
        installed.capabilityEdges.map((edge) => `${edge.fromNodeId}:${edge.toNodeId}:${edge.relationType}`),
        bundled.capabilityEdges.map((edge) => `${edge.fromNodeId}:${edge.toNodeId}:${edge.relationType}`)
      )
      && sameValues(
        installed.assessmentPolicies.map((policy) => policy.id),
        bundled.assessmentPolicies.map((policy) => policy.id)
      );
  }
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((value) => expected.has(value));
}
