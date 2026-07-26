import type { TutorDatabaseRuntime } from '@/composition-root/public';
import type { InstantMs, JsonObject } from '@/kernel/public';
import { candidateOnboardingPolicy } from '@/modules/candidate/public';

export class OnboardingDraftFeature {
  constructor(private readonly runtime: TutorDatabaseRuntime) {}

  load(draftId: string) {
    return this.runtime.candidateRepository.findOnboardingDraft(draftId);
  }

  save(command: {
    readonly draftId: string;
    readonly step: number;
    readonly data: JsonObject;
    readonly createdAt: number;
  }) {
    const now = Date.now();
    return this.runtime.candidateRepository.saveOnboardingDraft({
      id: command.draftId,
      stepCode: `onboarding.step.${command.step}`,
      data: command.data,
      createdAt: command.createdAt as InstantMs,
      updatedAt: now as InstantMs,
      expiresAt: (now + candidateOnboardingPolicy.draftRetentionMs) as InstantMs
    });
  }
}
