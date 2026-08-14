import { SHARED_PROMPT_EXAM_TYPE, type PromptBundle } from './PromptContracts';

export interface PinnedPromptRef {
  /**
   * The pack the prompt actually resolved from — the active track, or 'shared'
   * when it fell back. Pinned per prompt because a pack that later ships its own
   * wording for the same version would otherwise take over a running task.
   */
  readonly examType: string;
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
      if (resolved) {
        prompts[promptCode] = {
          examType: resolved.examType,
          version: resolved.version,
          contentHash: resolved.contentHash
        };
      }
    }
    return { examType: this.activeExamType, prompts };
  }

  /**
   * The exact bundle a pin names — same pack, same version, no fallback.
   *
   * Falling back to the shared catalog here would defeat the pin: a task that
   * resolved a shared prompt would start using a pack override the moment one
   * shipped under the same version.
   */
  findPinned(pin: PinnedPromptRef, promptCode: string): PromptBundle | undefined {
    return this.bundles.get(promptKey(pin.examType, promptCode, pin.version));
  }

  /**
   * Resolves checkpoints written before each prompt stored its actual owner.
   * The old top-level exam type described the active pack, so the original
   * resolution was its own wording first and the shared catalog second.
   */
  findLegacyPinned(
    activeExamType: string,
    promptCode: string,
    version: string,
    contentHash: string
  ): PromptBundle | undefined {
    const owned = this.resolveWithin(activeExamType, promptCode, version);
    if (owned?.contentHash === contentHash) return owned;
    const shared = activeExamType === SHARED_PROMPT_EXAM_TYPE
      ? undefined
      : this.resolveWithin(SHARED_PROMPT_EXAM_TYPE, promptCode, version);
    return shared?.contentHash === contentHash ? shared : undefined;
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
