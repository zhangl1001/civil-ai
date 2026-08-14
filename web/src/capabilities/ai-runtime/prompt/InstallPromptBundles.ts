import { PromptBundleEnsureStatus, type EnsurePromptBundle } from './EnsurePromptBundle';
import type { PromptBundle } from './PromptContracts';
import type { PromptRegistry } from './PromptRegistry';

/**
 * Persists prompts, then registers whatever the database accepted.
 *
 * Order matters in one direction only. Registering first would leave the runtime
 * compiling wording that was rejected on write, so a durable task replaying by
 * version would read one prompt from memory and a different one from storage.
 * On a conflict the stored copy wins, because storage is what the replay is
 * pinned against.
 */
export async function installPromptBundles(
  ensure: EnsurePromptBundle,
  registry: PromptRegistry,
  bundles: readonly PromptBundle[]
): Promise<void> {
  for (const bundle of bundles) {
    const status = await ensure.execute(bundle);
    const stored = status === PromptBundleEnsureStatus.Conflict
      ? await ensure.installed(bundle)
      : bundle;
    if (stored) registry.register(stored);
  }
}
