import { SHARED_PROMPT_EXAM_TYPE, type PromptBundle } from './PromptContracts';

export interface PinnedPromptRef {
  readonly version: string;
  readonly contentHash: string;
}

/** The prompt resolution a durable run was started against. */
export interface PromptResolutionPins {
  readonly examType: string;
  readonly prompts: Readonly<Record<string, PinnedPromptRef>>;
}

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

  /**
   * How every known prompt code resolves right now, including the pack it
   * resolved against.
   *
   * Durable work freezes this when a run starts. Pinning the version alone is
   * not enough: the same version number resolves to different wording once a
   * different pack is active, so the pack has to travel with it.
   */
  snapshot(): PromptResolutionPins {
    const prompts: Record<string, PinnedPromptRef> = {};
    for (const promptCode of new Set([...this.bundles.values()].map((bundle) => bundle.promptCode))) {
      const resolved = this.resolveWithin(this.activeExamType, promptCode)
        ?? this.resolveWithin(SHARED_PROMPT_EXAM_TYPE, promptCode);
      if (resolved) prompts[promptCode] = { version: resolved.version, contentHash: resolved.contentHash };
    }
    return { examType: this.activeExamType, prompts };
  }

  /**
   * The exact bundle a pin names, ignoring whichever pack is active now.
   * Undefined when that version is no longer shipped, which leaves the caller
   * to decide between failing and re-resolving.
   */
  findPinned(examType: string, promptCode: string, version: string): PromptBundle | undefined {
    return this.bundles.get(promptKey(examType, promptCode, version))
      ?? this.bundles.get(promptKey(SHARED_PROMPT_EXAM_TYPE, promptCode, version));
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
