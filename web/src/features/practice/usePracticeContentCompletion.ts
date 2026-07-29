import { ref, type Ref } from 'vue';
import {
  agentWorkerCoordinator,
  initializeTutorRuntime
} from '@/composition-root/public';
import {
  findQuestionSetEnrichmentNeeds,
  hasQuestionSetEnrichmentNeeds,
  type CommittedQuestionSetBundle
} from '@/modules/content/public';
import {
  PracticeSessionFeature,
  type PracticeSessionLoadResult
} from './PracticeSessionFeature';

interface PracticeContentCompletionOptions {
  readonly sessionFeature: () => Promise<PracticeSessionFeature>;
  readonly applyCompletedContent: (bundles: readonly CommittedQuestionSetBundle[]) => void;
}

interface PracticeContentCompletion {
  readonly contentCompleting: Ref<boolean>;
  readonly submissionPersisted: Ref<boolean>;
  needsCompletion(loaded: PracticeSessionLoadResult): boolean;
  completeBeforeReview(questionSetIds: readonly string[]): Promise<void>;
  refreshInBackground(questionSetIds: readonly string[]): Promise<void>;
}

export function usePracticeContentCompletion(
  options: PracticeContentCompletionOptions
): PracticeContentCompletion {
  const contentCompleting = ref(false);
  const submissionPersisted = ref(false);

  function needsCompletion(loaded: PracticeSessionLoadResult): boolean {
    const bundles = loaded.manifestSections.length
      ? loaded.manifestSections.map((item) => item.bundle)
      : [loaded.bundle];
    return bundles.some((item) => hasQuestionSetEnrichmentNeeds(
      findQuestionSetEnrichmentNeeds(item)
    ));
  }

  async function complete(
    questionSetIds: readonly string[],
    exposeProgress: boolean
  ): Promise<void> {
    if (exposeProgress) contentCompleting.value = true;
    try {
      const runtime = await initializeTutorRuntime();
      agentWorkerCoordinator.start(runtime);
      await (await options.sessionFeature()).waitForCompleteContent(questionSetIds, {
        onUpdate: options.applyCompletedContent
      });
    } finally {
      if (exposeProgress) contentCompleting.value = false;
    }
  }

  return {
    contentCompleting,
    submissionPersisted,
    needsCompletion,
    completeBeforeReview: (questionSetIds) => complete(questionSetIds, true),
    refreshInBackground: async (questionSetIds) => {
      try {
        await complete(questionSetIds, false);
      } catch (cause) {
        console.warn('[TutorPracticeSession] background content completion paused', cause);
      }
    }
  };
}
