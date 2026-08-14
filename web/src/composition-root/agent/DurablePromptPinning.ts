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
  const prompts = Object.fromEntries(
    Object.entries(object(stored.prompts)).flatMap(([promptCode, value]) => {
      const ref = object(value);
      return typeof ref.version === 'string' && typeof ref.contentHash === 'string'
        ? [[promptCode, { version: ref.version, contentHash: ref.contentHash }] as const]
        : [];
    })
  );
  if (typeof stored.examType === 'string' && Object.keys(prompts).length) {
    return { examType: stored.examType, prompts };
  }
  const pins = dependencies.promptRegistry.snapshot();
  await dependencies.updateAgentRunProgress.execute({
    agentRunId: run.run.id,
    step: TaskCenterStep.ResolvingPlan,
    progress: 1,
    message: '准备执行',
    data: { promptPins: pins as unknown as JsonObject },
    leaseToken: leaseTokenOf(run.run)
  });
  return pins;
}

/**
 * Compiles against the pinned bundle when it is still shipped.
 *
 * A pin that no longer resolves means the build dropped that version; the run
 * falls back to normal resolution and says so, which is better than failing a
 * task outright over wording.
 */
export function compilePinned(
  pins: PromptResolutionPins,
  dependencies: PromptPinningDependencies,
  promptCode: string,
  payload: Record<string, unknown>
) {
  const pin = pins.prompts[promptCode];
  const bundle = pin ? dependencies.promptRegistry.findPinned(pins.examType, promptCode, pin.version) : undefined;
  if (pin && !bundle) {
    console.warn('[TutorAgent] pinned prompt version is no longer available; re-resolving', {
      promptCode, examType: pins.examType, version: pin.version
    });
  }
  if (bundle && pin && bundle.contentHash !== pin.contentHash) {
    console.warn('[TutorAgent] pinned prompt content changed under its version', {
      promptCode, version: pin.version, pinned: pin.contentHash, available: bundle.contentHash
    });
  }
  return bundle
    ? dependencies.promptCompiler.compileBundle(bundle, {}, payload)
    : dependencies.promptCompiler.compile(promptCode, {}, payload);
}
