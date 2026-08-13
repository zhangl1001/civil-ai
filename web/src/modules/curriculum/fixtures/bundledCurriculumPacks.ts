import { createBusinessTutorPromptCatalog, type PromptBundle } from '@/capabilities/ai-runtime/public';
import type { CurriculumBundle } from '../contracts/CurriculumRepository';
import { createBundledNationalCurriculum } from './bundledNationalCurriculum';

/**
 * One exam track the app ships with. The pack owns everything that differs
 * between exams — subjects, modules, names, scoring bands and mock papers — so
 * adding a track means adding an entry here plus its metadata file, not editing
 * application code.
 */
export interface BundledCurriculumPack {
  /** Stable identifier persisted on the candidate's exam cycle. */
  readonly examType: string;
  /** Track name shown when the candidate chooses what they are preparing for. */
  readonly examName: string;
  readonly summary: string;
  /**
   * Whether the track is sat at national or provincial level. Only region-scoped
   * tracks show the scope and province fields on the exam profile form.
   */
  readonly regionScoped: boolean;
  readonly bundle: CurriculumBundle;
  /** Prompts whose wording belongs to this track. Anything absent falls back to the shared prompt. */
  readonly promptBundles: readonly PromptBundle[];
}

export function createBundledCurriculumPacks(): readonly BundledCurriculumPack[] {
  return [
    {
      examType: 'civil_service',
      examName: '公务员考试',
      summary: '行测与申论，覆盖国考与省考',
      regionScoped: true,
      bundle: createBundledNationalCurriculum(),
      promptBundles: createBusinessTutorPromptCatalog('civil_service')
    }
  ];
}
