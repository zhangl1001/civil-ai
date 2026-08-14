import { TaskCenterStep, leaseTokenOf, type AgentRunAggregate } from '@/modules/agent/public';
import type { JsonObject } from '@/kernel/public';
import type { PromptCompiler, PromptRegistry, PromptResolutionPins } from '@/capabilities/ai-runtime/public';
import type { UpdateAgentRunProgress } from '@/modules/agent/public';

/**
 * Only what pinning needs. Declared here rather than taken from the handler
 * dependency bag so this module does not depend back on its caller.
 */
export interface PromptPinningDependencies {
  readonly promptCompiler: PromptCompiler;
  readonly promptRegistry: PromptRegistry;
  readonly updateAgentRunProgress: UpdateAgentRunProgress;
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonObject;
}

/**
 * The prompt resolution this run is pinned to, frozen on its first execution.
 *
 * Written once, before any prompt is compiled, rather than accumulated as codes
 * are used: several executors compile and call the model in the same breath, so
 * a pin recorded on the next progress write would not survive a crash in
 * between. The pack is pinned alongside the versions because the same version
 * number resolves to different wording under a different pack.
 */
export async function pinPromptResolution(
  run: AgentRunAggregate,
  dependencies: PromptPinningDependencies
): Promise<PromptResolutionPins> {
  const stored = object(run.run.checkpoint.promptPins);
  const storedExamType = typeof stored.examType === 'string' ? stored.examType : undefined;
  const storedPromptEntries = Object.entries(object(stored.prompts));
  let migratedLegacyRef = false;
  const prompts = Object.fromEntries(
    storedPromptEntries.flatMap(([promptCode, value]) => {
      const ref = object(value);
      if (typeof ref.version !== 'string' || typeof ref.contentHash !== 'string') return [];
      if (typeof ref.examType === 'string') {
        return [[promptCode, { examType: ref.examType, version: ref.version, contentHash: ref.contentHash }] as const];
      }
      if (!storedExamType) return [];
      const bundle = dependencies.promptRegistry.findLegacyPinned(
        storedExamType,
        promptCode,
        ref.version,
        ref.contentHash
      );
      if (!bundle) return [];
      migratedLegacyRef = true;
      return [[promptCode, {
        examType: bundle.examType,
        version: ref.version,
        contentHash: ref.contentHash
      }] as const];
    })
  );
  if (storedPromptEntries.length) {
    if (!storedExamType || Object.keys(prompts).length !== storedPromptEntries.length) {
      throw new Error('Stored prompt resolution cannot be restored by this build');
    }
    const restored = { examType: storedExamType, prompts };
    if (migratedLegacyRef) await persistPins(run, dependencies, restored);
    return restored;
  }
  const pins = dependencies.promptRegistry.snapshot();
  await persistPins(run, dependencies, pins);
  return pins;
}

async function persistPins(
  run: AgentRunAggregate,
  dependencies: PromptPinningDependencies,
  pins: PromptResolutionPins
): Promise<void> {
  await dependencies.updateAgentRunProgress.execute({
    agentRunId: run.run.id,
    step: TaskCenterStep.ResolvingPlan,
    progress: 1,
    message: '准备执行',
    data: { promptPins: pins as unknown as JsonObject },
    leaseToken: leaseTokenOf(run.run)
  });
}

/**
 * Compiles the exact wording this run was pinned to.
 *
 * A pin that no longer resolves, or whose content moved under the same version,
 * is refused rather than quietly re-resolved: a durable task replays by version,
 * so silently swapping wording produces work nobody can explain afterwards. The
 * run fails and can be retried once the build agrees with what was pinned.
 */
export function compilePinned(
  pins: PromptResolutionPins,
  dependencies: PromptPinningDependencies,
  promptCode: string,
  payload: Record<string, unknown>
) {
  const pin = pins.prompts[promptCode];
  if (!pin) return dependencies.promptCompiler.compile(promptCode, {}, payload);
  const bundle = dependencies.promptRegistry.findPinned(pin, promptCode);
  if (!bundle) {
    throw new Error(
      `Prompt ${promptCode}@${pin.version} from ${pin.examType} is no longer available for this run`
    );
  }
  if (bundle.contentHash !== pin.contentHash) {
    throw new Error(
      `Prompt ${promptCode}@${pin.version} changed content since this run pinned it`
    );
  }
  return dependencies.promptCompiler.compileBundle(bundle, {}, payload);
}
