import type { PromptBundle } from './PromptContracts';

export class PromptRegistry {
  private readonly bundles = new Map<string, PromptBundle>();

  register(bundle: PromptBundle): void {
    const key = promptKey(bundle.promptCode, bundle.version);
    const existing = this.bundles.get(key);
    if (existing && existing.contentHash !== bundle.contentHash) {
      throw new Error(`Prompt ${key} is already registered with different content`);
    }
    this.bundles.set(key, bundle);
  }

  resolve(promptCode: string, version?: string): PromptBundle {
    if (version) {
      const exact = this.bundles.get(promptKey(promptCode, version));
      if (!exact) throw new Error(`Prompt ${promptCode}@${version} is not registered`);
      return exact;
    }
    const matches = [...this.bundles.values()]
      .filter((bundle) => bundle.promptCode === promptCode)
      .sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }));
    if (!matches[0]) throw new Error(`Prompt ${promptCode} is not registered`);
    return matches[0];
  }
}

function promptKey(promptCode: string, version: string): string {
  return `${promptCode}@${version}`;
}
