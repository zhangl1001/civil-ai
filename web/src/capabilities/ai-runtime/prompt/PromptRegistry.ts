import { SHARED_PROMPT_EXAM_TYPE, type PromptBundle } from './PromptContracts';

/**
 * Resolves prompts for the exam pack the candidate is preparing for.
 *
 * A pack ships wording only for the tasks whose voice differs; everything else
 * resolves to the shared prompt. The active pack is set once when a pack is
 * activated rather than threaded through every generation call, because no
 * layer between a workflow and a prompt has any other reason to know about
 * exam types.
 */
export class PromptRegistry {
  private readonly bundles = new Map<string, PromptBundle>();
  private activeExamType: string = SHARED_PROMPT_EXAM_TYPE;

  register(bundle: PromptBundle): void {
    const key = promptKey(bundle.examType, bundle.promptCode, bundle.version);
    const existing = this.bundles.get(key);
    if (existing && existing.contentHash !== bundle.contentHash) {
      throw new Error(`Prompt ${key} is already registered with different content`);
    }
    this.bundles.set(key, bundle);
  }

  /** Points resolution at a pack. Unknown codes still fall back to shared prompts. */
  activateExamType(examType: string): void {
    this.activeExamType = examType || SHARED_PROMPT_EXAM_TYPE;
  }

  resolve(promptCode: string, version?: string): PromptBundle {
    const owned = this.resolveWithin(this.activeExamType, promptCode, version);
    if (owned) return owned;
    const shared = this.activeExamType === SHARED_PROMPT_EXAM_TYPE
      ? undefined
      : this.resolveWithin(SHARED_PROMPT_EXAM_TYPE, promptCode, version);
    if (shared) return shared;
    const suffix = version ? `@${version}` : '';
    throw new Error(`Prompt ${promptCode}${suffix} is not registered for ${this.activeExamType}`);
  }

  private resolveWithin(examType: string, promptCode: string, version?: string): PromptBundle | undefined {
    if (version) return this.bundles.get(promptKey(examType, promptCode, version));
    return [...this.bundles.values()]
      .filter((bundle) => bundle.examType === examType && bundle.promptCode === promptCode)
      .sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }))[0];
  }
}

function promptKey(examType: string, promptCode: string, version: string): string {
  return `${examType}/${promptCode}@${version}`;
}
