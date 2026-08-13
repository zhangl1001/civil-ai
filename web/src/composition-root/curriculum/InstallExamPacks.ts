import type { EnsurePromptBundle, PromptRegistry } from '@/capabilities/ai-runtime/public';
import { installCurriculumLabels } from '@/domain/labels';
import { installWrittenFormats } from '@/domain/writtenFormats';
import type { AlignCandidateCurriculum, CandidateRepository } from '@/modules/candidate/public';
import { projectExamSubjects, type BundledCurriculumPack, type EnsureCurriculumBundle } from '@/modules/curriculum/public';

/**
 * Brings every bundled exam pack into the database and activates the one the
 * candidate is preparing for: their cycle is re-pointed at the current release
 * of that pack, and prompts, UI labels and answer formats switch to it.
 *
 * Packs are installed unconditionally so a candidate can switch tracks without
 * a download; only one is active at a time.
 */
export class InstallExamPacks {
  constructor(
    private readonly packs: readonly BundledCurriculumPack[],
    private readonly ensureCurriculum: EnsureCurriculumBundle,
    private readonly alignCandidateCurriculum: AlignCandidateCurriculum,
    private readonly candidateRepository: CandidateRepository,
    private readonly ensurePromptBundle: EnsurePromptBundle,
    private readonly promptRegistry: PromptRegistry
  ) {}

  async execute(): Promise<void> {
    for (const pack of this.packs) {
      await this.ensureCurriculum.execute(pack.bundle);
      for (const prompt of pack.promptBundles) {
        this.promptRegistry.register(prompt);
        await this.ensurePromptBundle.execute(prompt);
      }
    }
    const active = await this.resolveActivePack();
    if (!active) return;
    await this.alignCandidateCurriculum.execute(active.bundle);
    // Prompts resolve against the active track first and fall back to the
    // shared catalog, so a pack only ships the wording it actually changes.
    this.promptRegistry.activateExamType(active.examType);
    installCurriculumLabels(active.bundle.capabilityNodes);
    installWrittenFormats(projectExamSubjects(active.bundle));
  }

  /**
   * The candidate's own pack. Before onboarding there is no cycle yet, so the
   * first bundled pack seeds the UI.
   *
   * A cycle whose exam type has no installed pack activates nothing: falling
   * back would re-point that candidate's curriculum at a different exam, which
   * silently rewrites their study plan rather than degrading.
   */
  private async resolveActivePack(): Promise<BundledCurriculumPack | undefined> {
    const cycle = await this.candidateRepository.findCurrentCycle();
    if (!cycle) return this.packs[0];
    const owned = this.packs.find((pack) => pack.examType === cycle.examCycle.examType);
    if (!owned) {
      console.warn('[ExamPacks] no installed pack for the candidate exam type; leaving the cycle untouched', {
        examType: cycle.examCycle.examType,
        installed: this.packs.map((pack) => pack.examType)
      });
    }
    return owned;
  }
}
