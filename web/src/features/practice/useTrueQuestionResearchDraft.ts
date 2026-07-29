import { ref } from 'vue';
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router';
import { initializeTutorRuntime } from '@/composition-root/public';
import {
  type QuestionImportCandidateId,
  type QuestionImportDraftId
} from '@/kernel/public';
import {
  QuestionImportCandidateStatus,
  QuestionImportDraftStatus,
  type QuestionImportDraftAggregate
} from '@/modules/content/public';

export function useTrueQuestionResearchDraft(input: {
  readonly route: RouteLocationNormalizedLoaded;
  readonly router: Router;
  readonly reloadLibrary: () => Promise<unknown>;
  readonly reportPageError: (message: string) => void;
  readonly activateTrueQuestionMode: () => void;
}) {
  const showResearchDraft = ref(false);
  const publishingResearchDraft = ref(false);
  const researchDraftError = ref('');
  const researchDraft = ref<QuestionImportDraftAggregate | null>(null);

  async function loadResearchDraftFromRoute() {
    const draftId = String(input.route.query.draftId || '').trim();
    if (!draftId) return;
    input.activateTrueQuestionMode();
    researchDraftError.value = '';
    try {
      const runtime = await initializeTutorRuntime();
      const draft = await runtime.questionImportDraftRepository.find(draftId as QuestionImportDraftId);
      if (!draft) throw new Error('待确认真题草稿不存在或已经清理。');
      researchDraft.value = draft;
      showResearchDraft.value = true;
    } catch (cause) {
      input.reportPageError(cause instanceof Error ? cause.message : '读取真题草稿失败');
    }
  }

  async function publishResearchDraft() {
    const current = researchDraft.value;
    if (!current || publishingResearchDraft.value) return;
    publishingResearchDraft.value = true;
    researchDraftError.value = '';
    try {
      const runtime = await initializeTutorRuntime();
      const rejectedCandidateIds = current.candidates
        .filter((candidate) => candidate.status !== QuestionImportCandidateStatus.Ready)
        .map((candidate) => candidate.id as QuestionImportCandidateId);
      const confirmed = current.draft.status === QuestionImportDraftStatus.Confirmed
        ? current
        : await confirmAndReload(current, rejectedCandidateIds);
      if (confirmed.draft.status !== QuestionImportDraftStatus.Confirmed) {
        researchDraft.value = confirmed;
        throw new Error('草稿仍有来源或题目结构需要确认，暂时不能入库。');
      }
      await runtime.publishQuestionImportDraft.execute({
        draftId: confirmed.draft.id,
        expectedVersion: confirmed.draft.version,
        idempotencyKey: `practice-center:${confirmed.draft.id}:publish`
      });
      showResearchDraft.value = false;
      researchDraft.value = null;
      await input.reloadLibrary();
      const query = { ...input.route.query };
      delete query.draftId;
      await input.router.replace({ query });
    } catch (cause) {
      researchDraftError.value = cause instanceof Error ? cause.message : '真题草稿入库失败';
    } finally {
      publishingResearchDraft.value = false;
    }
  }

  async function confirmAndReload(
    current: QuestionImportDraftAggregate,
    rejectedCandidateIds: readonly QuestionImportCandidateId[]
  ): Promise<QuestionImportDraftAggregate> {
    const runtime = await initializeTutorRuntime();
    await runtime.confirmQuestionImportDraft.execute({
      draftId: current.draft.id,
      expectedVersion: current.draft.version,
      rejectedCandidateIds
    });
    const refreshed = await runtime.questionImportDraftRepository.find(current.draft.id);
    if (!refreshed) throw new Error('确认后无法读取真题草稿。');
    return refreshed;
  }

  return {
    showResearchDraft,
    publishingResearchDraft,
    researchDraftError,
    researchDraft,
    loadResearchDraftFromRoute,
    publishResearchDraft
  };
}
