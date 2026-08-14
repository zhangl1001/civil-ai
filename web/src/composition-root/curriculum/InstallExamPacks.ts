import { installPromptBundles, type EnsurePromptBundle, type PromptRegistry } from '@/capabilities/ai-runtime/public';
import { installCurriculumLabels } from '@/domain/labels';
import { installChoiceGradingRule } from '@/domain/choiceGradingRules';
import { installWrittenFormats } from '@/domain/writtenFormats';
import { installSubjectDelivery } from '@/domain/subjectDelivery';
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
      await installPromptBundles(this.ensurePromptBundle, this.promptRegistry, pack.promptBundles);
    }
    await this.activate();
  }

  /**
   * Points the running app at the candidate's own track.
   *
   * Separate from installation because the runtime is a singleton created before
   * a candidate exists: onboarding starts with the seed pack active, so the app
   * would keep the wrong labels, prompts and scoring rules until a restart
   * unless creating a cycle re-activates.
   */
  async activate(): Promise<void> {
    const active = await this.resolveActivePack();
    if (!active) return;
    await this.alignCandidateCurriculum.execute(active.bundle);
    // Prompts resolve against the active track first and fall back to the
    // shared catalog, so a pack only ships the wording it actually changes.
    this.promptRegistry.activateExamType(active.examType);
    const subjects = projectExamSubjects(active.bundle);
    installCurriculumLabels(active.bundle.capabilityNodes);
    installWrittenFormats(subjects);
    installChoiceGradingRule(subjects);
    installSubjectDelivery(subjects, active.bundle.capabilityNodes);
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
