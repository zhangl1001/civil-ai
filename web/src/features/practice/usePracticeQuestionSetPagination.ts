import { computed, ref, type Ref } from 'vue';
import {
  QuestionOriginType,
  QuestionSetEntryMode,
  type QuestionSetLibraryCursor,
  type QuestionSetLibraryEntry,
  type QuestionSetPracticeStatusCode
} from '@/modules/content/public';
import type { PracticeCenterFeature, QuestionSetLibraryPage } from './PracticeCenterFeature';

export type PracticeCenterMode = 'tutor' | 'self' | 'true';

interface TrueQuestionFilters {
  readonly origin: Ref<'all' | typeof QuestionOriginType.Official | typeof QuestionOriginType.Imported | typeof QuestionOriginType.UserCreated>;
  readonly year: Ref<number>;
  readonly province: Ref<string>;
  readonly module: Ref<string>;
  readonly status: Ref<'all' | QuestionSetPracticeStatusCode>;
}

interface InitialQuestionSetPages {
  readonly tutorPage: QuestionSetLibraryPage;
  readonly selfPage: QuestionSetLibraryPage;
  readonly trueQuestionPage: QuestionSetLibraryPage;
}

export function usePracticeQuestionSetPagination(
  getFeature: () => Promise<PracticeCenterFeature>,
  activeMode: Ref<PracticeCenterMode>,
  filters: TrueQuestionFilters
) {
  const tutor = pageState();
  const self = pageState();
  const trueQuestions = pageState();
  const loadingMore = ref(false);
  let trueQueryVersion = 0;

  const visibleSets = computed(() => stateFor(activeMode.value).entries.value);
  const activePageHasMore = computed(() => stateFor(activeMode.value).hasMore.value);

  function initializePages(pages: InitialQuestionSetPages): void {
    applyPage(tutor, pages.tutorPage);
    applyPage(self, pages.selfPage);
    applyPage(trueQuestions, pages.trueQuestionPage);
  }

  async function loadMoreSets(): Promise<void> {
    const mode = activeMode.value;
    const state = stateFor(mode);
    if (loadingMore.value || !state.hasMore.value) return;
    const version = trueQueryVersion;
    loadingMore.value = true;
    try {
      const page = await (await getFeature()).listQuestionSetPage(pageQuery(mode, state.cursor.value));
      if (mode === 'true' && version !== trueQueryVersion) return;
      applyPage(state, page, true);
    } finally {
      loadingMore.value = false;
    }
  }

  async function reloadTrueQuestionSets(): Promise<void> {
    const version = ++trueQueryVersion;
    loadingMore.value = true;
    try {
      const page = await (await getFeature()).listQuestionSetPage(pageQuery('true'));
      if (version !== trueQueryVersion) return;
      applyPage(trueQuestions, page);
    } finally {
      if (version === trueQueryVersion) loadingMore.value = false;
    }
  }

  async function reloadGeneratedQuestionSets(mode: 'tutor' | 'self'): Promise<void> {
    applyPage(stateFor(mode), await (await getFeature()).listQuestionSetPage(pageQuery(mode)));
  }

  function pageQuery(mode: PracticeCenterMode, cursor?: QuestionSetLibraryCursor) {
    if (mode === 'tutor' || mode === 'self') {
      return {
        originTypes: GENERATED_ORIGINS,
        entryModes: [mode === 'tutor' ? QuestionSetEntryMode.Tutor : QuestionSetEntryMode.Self],
        cursor,
        limit: PAGE_SIZE
      };
    }
    return {
      originTypes: filters.origin.value === 'all' ? TRUE_QUESTION_ORIGINS : [filters.origin.value],
      practiceStatuses: filters.status.value === 'all' ? undefined : [filters.status.value],
      modules: filters.module.value ? [filters.module.value] : undefined,
      examYears: filters.year.value ? [filters.year.value] : undefined,
      provinces: filters.province.value ? [filters.province.value] : undefined,
      cursor,
      limit: PAGE_SIZE
    };
  }

  function stateFor(mode: PracticeCenterMode) {
    return mode === 'tutor' ? tutor : mode === 'self' ? self : trueQuestions;
  }

  return {
    loadingMore,
    tutorSets: tutor.entries,
    selfSets: self.entries,
    trueQuestionSets: trueQuestions.entries,
    visibleSets,
    activePageHasMore,
    initializePages,
    loadMoreSets,
    reloadTrueQuestionSets,
    reloadGeneratedQuestionSets
  };
}

function pageState() {
  return {
    entries: ref<readonly QuestionSetLibraryEntry[]>([]),
    cursor: ref<QuestionSetLibraryCursor>(),
    hasMore: ref(false)
  };
}

function applyPage(state: ReturnType<typeof pageState>, page: QuestionSetLibraryPage, append = false): void {
  state.entries.value = append ? appendUnique(state.entries.value, page.entries) : page.entries;
  state.cursor.value = page.nextCursor;
  state.hasMore.value = page.hasMore;
}

function appendUnique(current: readonly QuestionSetLibraryEntry[], next: readonly QuestionSetLibraryEntry[]) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !seen.has(item.id))];
}

const PAGE_SIZE = 12;
const GENERATED_ORIGINS = [QuestionOriginType.AiGenerated, QuestionOriginType.AiVariant, QuestionOriginType.DiagnosticAnchor] as const;
const TRUE_QUESTION_ORIGINS = [QuestionOriginType.Official, QuestionOriginType.Imported, QuestionOriginType.UserCreated] as const;
