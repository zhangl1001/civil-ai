import { installCurriculumLabels } from '@/domain/labels';
import { installWrittenFormats } from '@/domain/writtenFormats';
import type { AlignCandidateCurriculum, CandidateRepository } from '@/modules/candidate/public';
import { projectExamSubjects, type BundledCurriculumPack, type EnsureCurriculumBundle } from '@/modules/curriculum/public';

/**
 * Brings every bundled exam pack into the database and activates the one the
 * candidate is preparing for: their cycle is re-pointed at the current release
 * of that pack, and the UI label catalog is switched to its names.
 *
 * Packs are installed unconditionally so a candidate can switch tracks without
 * a download; only one is active at a time.
 */
export class InstallExamPacks {
  constructor(
    private readonly packs: readonly BundledCurriculumPack[],
    private readonly ensureCurriculum: EnsureCurriculumBundle,
    private readonly alignCandidateCurriculum: AlignCandidateCurriculum,
    private readonly candidateRepository: CandidateRepository
  ) {}

  async execute(): Promise<void> {
    for (const pack of this.packs) {
      await this.ensureCurriculum.execute(pack.bundle);
    }
    const active = await this.resolveActivePack();
    if (!active) return;
    await this.alignCandidateCurriculum.execute(active.bundle);
    installCurriculumLabels(active.bundle.capabilityNodes);
    installWrittenFormats(projectExamSubjects(active.bundle));
  }

  /** The candidate's own pack, falling back to the first bundled one before onboarding. */
  private async resolveActivePack(): Promise<BundledCurriculumPack | undefined> {
    const cycle = await this.candidateRepository.findCurrentCycle();
    const examType = cycle?.examCycle.examType;
    return this.packs.find((pack) => pack.examType === examType) ?? this.packs[0];
  }
}
