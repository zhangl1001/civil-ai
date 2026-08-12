<template>
  <div class="tutor-wrongbook app-page">
    <PageHeader title="错题本" :meta="!loaded ? '错题归因与巩固' : mode === 'browse' ? `${entries.length} 道待巩固` : `已选 ${selectedReviewEntries.length} 道`">
      <template #actions>
        <button class="header-icon" type="button" aria-label="筛选错题" @click="showFilter = true"><FilterIcon /></button>
        <button v-if="mode === 'browse'" class="header-icon" type="button" aria-label="打开错题闪卡" :disabled="!filtered.length" @click="openFlashcard"><LayersIcon /></button>
      </template>
    </PageHeader>

    <PullToRefresh class="wrongbook-scroll" :on-refresh="load">
      <SegmentedControl v-model="mode" label="错题本模式" :options="modeOptions" />

      <InitialRefreshState v-if="!loaded" label="正在刷新错题" />
      <AppStateView v-else-if="error && !entries.length" state="error" title="错题暂不可用" :description="error" action-label="重试" @action="load" />
      <AppStateView
        v-else-if="!filtered.length"
        state="success"
        :title="entries.length ? '当前筛选下没有错题' : mode === 'browse' ? '暂无待巩固错题' : '暂无可重做错题'"
        :description="entries.length ? '调整筛选条件，或继续完成新的针对性练习。' : '每次提交后，答错题会自动写入这里。'"
      />

      <InfiniteScrollPagination :has-more="moreAvailable" :has-items="Boolean(filtered.length)" :loading="loadingMore" :on-load-more="loadMore" :show-end="mode === 'browse'">
      <section v-if="loaded && !error && filtered.length && mode === 'browse'" class="wrong-list" aria-label="错题列表">
        <article v-for="entry in filtered" :key="entry.id" :class="['wrong-entry', { expanded: expandedId === entry.id }]">
          <button class="wrong-summary" type="button" @click="toggle(entry.id)">
            <span class="cause-dot"></span>
            <span class="wrong-copy"><strong>{{ cause(entry) }}</strong><em>{{ summary(entry.question.content.prompt) }}</em><small>{{ entry.question.sequence }} 题 · {{ entry.session.sessionType === 'review' ? '复习训练' : '独立练习' }} · {{ formatTime(entry.attempt.submittedAt) }}</small></span>
            <ChevronDownIcon :class="{ rotated: expandedId === entry.id }" />
          </button>
          <div v-if="expandedId === entry.id" class="wrong-detail">
            <QuestionContentTemplate
              :question="entry.question.content"
              :layout="QuestionRegionLayoutCode.WrongBook"
              :selected-option-id="selectedOptionId(entry)"
              reveal-result
              readonly-mode
              compact
              show-explanation
            >
              <template #diagnosis>
                <section class="diagnosis-note">
                  <span>错因分析</span>
                  <template v-if="entry.diagnoses.length">
                    <ErrorDiagnosisInsight
                      :cause-code="effectiveDiagnosis(entry)!.causeCode"
                      :cause-label="cause(entry)"
                      :detail="detail(entry)"
                      :dimensions="effectiveDiagnosis(entry)!.diagnosis.dimensions"
                      :correction-plan="effectiveDiagnosis(entry)!.diagnosis.correctionPlan"
                    />
                  </template>
                  <p v-else>目前只有答题结果，还没有形成可靠的错因判断。</p>
                  <button
                    v-if="!hasSpecificDiagnosis(entry)"
                    class="diagnosis-retry"
                    type="button"
                    :disabled="isAnalyzing(entry)"
                    @click="analyzeDiagnosis(entry)"
                  >{{ isAnalyzing(entry) ? 'AI 正在分析' : '重新分析错因' }}</button>
                </section>
              </template>
            </QuestionContentTemplate>
          </div>
        </article>
      </section>

      <section v-else-if="loaded && !error && filtered.length" class="review-workspace" aria-label="错题重做">
        <p class="review-intro">直接使用原题检验是否真正掌握，不重新生成题目。单次最多 {{ maxReviewCount }} 道。</p>
        <div class="review-toolbar">
          <button class="review-select-all" type="button" :aria-pressed="allReviewSelected" @click="toggleAllReview">
            <span :class="['review-check', { selected: allReviewSelected || someReviewSelected }]">
              <CheckIcon v-if="allReviewSelected" />
              <MinusIcon v-else-if="someReviewSelected" />
            </span>
            <span>{{ allReviewSelected ? '取消全选' : `全选${reviewCandidates.length > maxReviewCount ? `前 ${maxReviewCount} 道` : ''}` }}</span>
          </button>
          <span class="review-count">已选 {{ selectedReviewEntries.length }} / {{ reviewCandidates.length }}</span>
        </div>
        <p v-if="reviewCapReached" class="review-cap" role="status">已达单次上限 {{ maxReviewCount }} 道，取消勾选后可以换其他题。</p>
        <div class="review-list">
          <button
            v-for="entry in reviewCandidates"
            :key="entry.question.id"
            type="button"
            :class="{ selected: isSelectedForReview(entry) }"
            :disabled="!isSelectedForReview(entry) && reviewCapReached"
            @click="toggleReviewSelection(entry)"
          >
            <span class="review-check"><CheckIcon v-if="isSelectedForReview(entry)" /></span>
            <span class="review-copy">
              <strong>{{ summary(entry.question.content.prompt) }}</strong>
              <small>{{ practiceModuleLabel(entry.module) }} · {{ cause(entry) }} · {{ formatTime(entry.attempt.submittedAt) }}</small>
            </span>
          </button>
        </div>
      </section>
      </InfiniteScrollPagination>
      <p v-if="error && entries.length" class="sync-error">{{ error }}</p>
    </PullToRefresh>

    <StickyActionBar v-if="mode === 'review' && loaded && !error && filtered.length" avoid-bottom-nav>
      <button
        class="primary start-review"
        type="button"
        :disabled="startingReview || !selectedReviewEntries.length"
        @click="startReview"
      >
        <RotateCcwIcon />
        {{ startingReview ? '正在准备错题...' : selectedReviewEntries.length ? `开始重做 ${selectedReviewEntries.length} 道` : '请选择要重做的错题' }}
      </button>
    </StickyActionBar>

    <BottomSheet v-model="showFilter" title="错题筛选" subtitle="按训练模块与已确认错因过滤" variant="filter">
      <div class="filter-form">
        <label>
          <span>训练模块</span>
          <div class="filter-options">
            <button type="button" :class="{ active: moduleFilter === '' }" @click="moduleFilter = ''">全部模块</button>
            <button v-for="module in modules" :key="module" type="button" :class="{ active: moduleFilter === module }" @click="moduleFilter = module">{{ practiceModuleLabel(module) }}</button>
          </div>
        </label>
        <label>
          <span>错因类型</span>
          <div class="filter-options">
            <button type="button" :class="{ active: causeFilter === '' }" @click="causeFilter = ''">全部错因</button>
            <button v-for="item in causes" :key="item" type="button" :class="{ active: causeFilter === item }" @click="causeFilter = item">{{ item }}</button>
          </div>
        </label>
      </div>
    </BottomSheet>

    <CenterDialog v-model="showFlashcards" title="错题闪卡" :subtitle="flashcard ? `${flashcardIndex + 1}/${filtered.length}` : '暂无错题'" variant="content">
      <template v-if="flashcard">
        <div class="flashcard-top"><span>{{ cause(flashcard) }}</span><small>{{ formatTime(flashcard.attempt.submittedAt) }}</small></div>
        <QuestionContentTemplate
          :question="flashcard.question.content"
          :layout="QuestionRegionLayoutCode.Flashcard"
          :selected-option-id="selectedOptionId(flashcard)"
          :reveal-result="revealed"
          readonly-mode
          compact
          :show-explanation="revealed"
        >
          <template #diagnosis>
            <section v-if="revealed" class="diagnosis-note">
              <span>错因分析</span>
              <ErrorDiagnosisInsight
                :cause-code="effectiveDiagnosis(flashcard)!.causeCode"
                :cause-label="cause(flashcard)"
                :detail="detail(flashcard)"
                :dimensions="effectiveDiagnosis(flashcard)!.diagnosis.dimensions"
                :correction-plan="effectiveDiagnosis(flashcard)!.diagnosis.correctionPlan"
              />
            </section>
          </template>
        </QuestionContentTemplate>
        <button class="reveal-button" type="button" @click="revealed = !revealed">{{ revealed ? '收起答案与解析' : '查看答案与解析' }}</button>
        <div class="flashcard-actions"><button type="button" :disabled="flashcardIndex === 0" @click="flashcardIndex--">上一张</button><button type="button" @click="openReviewFromFlashcard(flashcard)">错题重做</button><button type="button" :disabled="flashcardIndex >= filtered.length - 1" @click="flashcardIndex++">下一张</button></div>
      </template>
    </CenterDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { CheckIcon, ChevronDownIcon, FilterIcon, LayersIcon, MinusIcon, RotateCcwIcon } from 'lucide-vue-next';
import { AppStateView, InfiniteScrollPagination, InitialRefreshState, PullToRefresh, SegmentedControl, StickyActionBar } from '@/capabilities/design-system/public';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import CenterDialog from '@/components/layout/CenterDialog.vue';
import QuestionContentTemplate from '@/components/question/QuestionContentTemplate.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import ErrorDiagnosisInsight from '@/components/learning/ErrorDiagnosisInsight.vue';
import { initializeTutorRuntime } from '@/composition-root/public';
import { practiceModuleLabel } from '@/domain/labels';
import { errorCauseLabel, type WrongBookDiagnosis, type WrongBookEntry } from '@/modules/evidence/public';
import { QuestionRegionLayoutCode, type ContentDocument } from '@/modules/content/public';
import { peekWrongBookEntries, WrongBookFeature } from './WrongBookFeature';

const router = useRouter();
const initialEntries = peekWrongBookEntries();
const pageSize = 40;
const loading = ref(false); const loadingMore = ref(false); const loaded = ref(Boolean(initialEntries)); const error = ref(''); const entries = ref<readonly WrongBookEntry[]>((initialEntries || []).slice(0, pageSize));
const moreAvailable = ref(true);
const mode = ref<'browse' | 'review'>('browse');
const expandedId = ref<string>(); const showFilter = ref(false); const showFlashcards = ref(false); const flashcardIndex = ref(0); const revealed = ref(false);
const moduleFilter = ref(''); const causeFilter = ref('');
const analyzingEntryIds = ref<readonly string[]>([]);
const selectedReviewIds = ref<string[]>([]);
const startingReview = ref(false);
const maxReviewCount = 30;
const modeOptions = [
  { value: 'browse', label: '错题浏览' },
  { value: 'review', label: '错题重做' }
] as const;
let featurePromise: Promise<WrongBookFeature> | undefined;
const modules = computed(() => [...new Set(entries.value.map((entry) => entry.module).filter(Boolean))].sort());
const causes = computed(() => [...new Set(entries.value.map(cause))].sort());
const filtered = computed(() => entries.value.filter((entry) => (!moduleFilter.value || entry.module === moduleFilter.value) && (!causeFilter.value || cause(entry) === causeFilter.value)));
const reviewCandidates = computed(() => [...new Map(
  filtered.value.map((entry) => [String(entry.question.id), entry])
).values()]);
const selectedReviewEntries = computed(() => {
  const selected = new Set(selectedReviewIds.value);
  return reviewCandidates.value.filter((entry) => selected.has(String(entry.question.id)));
});
const selectableReviewIds = computed(() => reviewCandidates.value
  .slice(0, maxReviewCount)
  .map((entry) => String(entry.question.id)));
const allReviewSelected = computed(() => selectableReviewIds.value.length > 0
  && selectableReviewIds.value.every((id) => selectedReviewIds.value.includes(id)));
const someReviewSelected = computed(() => !allReviewSelected.value
  && selectableReviewIds.value.some((id) => selectedReviewIds.value.includes(id)));
const reviewCapReached = computed(() => selectedReviewIds.value.length >= maxReviewCount);
const flashcard = computed(() => filtered.value[flashcardIndex.value]);

onMounted(() => { void load(); });
watch(filtered, () => { if (flashcardIndex.value >= filtered.value.length) flashcardIndex.value = Math.max(0, filtered.value.length - 1); });
watch(flashcardIndex, () => { revealed.value = false; });
watch(mode, (next) => {
  if (next === 'review' && !selectedReviewIds.value.length) selectDefaultReview();
});
watch(reviewCandidates, (values) => {
  const available = new Set(values.map((entry) => String(entry.question.id)));
  selectedReviewIds.value = selectedReviewIds.value.filter((id) => available.has(id));
  if (mode.value === 'review' && !selectedReviewIds.value.length) selectDefaultReview();
});

async function load() {
  if (loading.value) return;
  loading.value = true; error.value = '';
  try {
    const currentFeature = await feature();
    entries.value = await currentFeature.list(pageSize, { refresh: true });
    moreAvailable.value = currentFeature.hasMore();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取错题失败'; }
  finally {
    loaded.value = true;
    loading.value = false;
  }
}
async function loadMore() {
  if (loadingMore.value || !moreAvailable.value) return;
  loadingMore.value = true;
  try {
    const currentFeature = await feature();
    entries.value = await currentFeature.list(entries.value.length + pageSize);
    moreAvailable.value = currentFeature.hasMore();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取更多错题失败';
  } finally {
    loadingMore.value = false;
  }
}
function toggle(id: string) { expandedId.value = expandedId.value === id ? undefined : id; }
function cause(entry: WrongBookEntry): string {
  const code = effectiveDiagnosis(entry)?.causeCode as keyof typeof errorCauseLabel | undefined;
  return code ? errorCauseLabel[code] : '需要补充证据';
}
function detail(entry: WrongBookEntry): string {
  const diagnosis = effectiveDiagnosis(entry);
  return diagnosis && diagnosis.causeCode !== 'unknown'
    ? diagnosis.detail
    : '目前只能确认本题答错，暂时还无法判断具体原因。完成深度分析后会自动更新。';
}
function selectedOptionId(entry: WrongBookEntry): string { return typeof entry.attempt.answer.optionId === 'string' ? entry.attempt.answer.optionId : ''; }
function effectiveDiagnosis(entry: WrongBookEntry): WrongBookDiagnosis | undefined { return [...entry.diagnoses].sort((left, right) => diagnosisPriority(right) - diagnosisPriority(left) || right.diagnosis.createdAt - left.diagnosis.createdAt)[0]; }
function hasSpecificDiagnosis(entry: WrongBookEntry): boolean {
  const diagnosis = effectiveDiagnosis(entry);
  return Boolean(diagnosis && diagnosis.causeCode !== 'unknown');
}
function diagnosisPriority(value: WrongBookDiagnosis): number { return value.diagnosis.source === 'tutor_ai' ? 2 : value.causeCode === 'unknown' ? 0 : 1; }
function summary(document: ContentDocument): string { const text = collectText(document).replace(/\s+/g, ' ').trim(); return text.length > 46 ? `${text.slice(0, 46)}...` : text || '题目内容'; }
function collectText(document: ContentDocument): string { return document.blocks.map((block) => block.type === 'text' ? block.source : block.type === 'callout' ? collectText({ schemaVersion: document.schemaVersion, blocks: block.blocks }) : block.type === 'data_table' ? `${block.caption || ''} ${block.rows.map((row) => Object.values(row).join(' ')).join(' ')}` : block.type === 'formula' ? block.source : block.type === 'svg_diagram' ? block.alt : block.type === 'image' ? block.alt : '').join(' '); }
function formatTime(value: number): string { return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }); }
function openFlashcard() { flashcardIndex.value = 0; revealed.value = false; showFlashcards.value = true; }
function selectDefaultReview() {
  selectedReviewIds.value = reviewCandidates.value
    .slice(0, Math.min(10, maxReviewCount))
    .map((entry) => String(entry.question.id));
}
function toggleAllReview() {
  if (allReviewSelected.value) {
    const selectable = new Set(selectableReviewIds.value);
    selectedReviewIds.value = selectedReviewIds.value.filter((id) => !selectable.has(id));
    return;
  }
  selectedReviewIds.value = [...selectableReviewIds.value];
}
function isSelectedForReview(entry: WrongBookEntry): boolean {
  return selectedReviewIds.value.includes(String(entry.question.id));
}
function toggleReviewSelection(entry: WrongBookEntry) {
  const id = String(entry.question.id);
  if (selectedReviewIds.value.includes(id)) {
    selectedReviewIds.value = selectedReviewIds.value.filter((item) => item !== id);
    return;
  }
  if (selectedReviewIds.value.length < maxReviewCount) {
    selectedReviewIds.value = [...selectedReviewIds.value, id];
  }
}
function openReviewFromFlashcard(entry: WrongBookEntry) {
  const id = String(entry.question.id);
  if (!selectedReviewIds.value.includes(id)) {
    selectedReviewIds.value = [id, ...selectedReviewIds.value].slice(0, maxReviewCount);
  }
  showFlashcards.value = false;
  mode.value = 'review';
}
function isAnalyzing(entry: WrongBookEntry): boolean { return analyzingEntryIds.value.includes(entry.id); }
async function analyzeDiagnosis(entry: WrongBookEntry) {
  if (isAnalyzing(entry)) return;
  analyzingEntryIds.value = [...analyzingEntryIds.value, entry.id];
  try {
    await (await feature()).analyze(entry);
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '错因分析启动失败';
  } finally {
    analyzingEntryIds.value = analyzingEntryIds.value.filter((id) => id !== entry.id);
  }
}
async function startReview() {
  if (!selectedReviewEntries.value.length || startingReview.value) return;
  startingReview.value = true;
  error.value = '';
  try {
    const manifestId = await (await feature()).startReview(selectedReviewEntries.value);
    await router.push({
      path: '/vue/practice/objective-session',
      query: { manifestId }
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '错题重做启动失败';
  } finally {
    startingReview.value = false;
  }
}
function feature(): Promise<WrongBookFeature> {
  featurePromise ??= initializeTutorRuntime().then((runtime) => new WrongBookFeature(runtime));
  return featurePromise;
}
</script>

<style scoped>
.wrongbook-scroll { display:flex; flex-direction:column; gap:12px; padding-top:12px; }.header-icon { width:36px; height:36px; display:grid; place-items:center; border:0; border-radius:50%; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.1); }.header-icon:disabled { opacity:.4; }.header-icon svg { width:17px; height:17px; }.wrong-list { overflow:hidden; border-radius:var(--radius-card); background:var(--surface-card); }.wrong-entry { border-top:1px solid var(--border-subtle); }.wrong-entry:first-child { border-top:0; }.wrong-summary { width:100%; min-height:72px; display:flex; align-items:flex-start; gap:10px; padding:12px; border:0; background:transparent; color:inherit; text-align:left; }.cause-dot { width:7px; height:7px; margin-top:6px; border-radius:var(--radius-pill); background:var(--orange-color); flex:0 0 auto; }.wrong-copy { min-width:0; flex:1; display:flex; flex-direction:column; gap:4px; }.wrong-copy strong { color:var(--text-secondary-color); font-size:var(--type-size-micro); font-weight:var(--type-weight-semibold); letter-spacing:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }.wrong-copy em { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; color:var(--text-color); font-size:var(--type-size-body); font-style:normal; line-height:1.5; }.wrong-copy small { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; color:var(--text-secondary-color); font-size:var(--type-size-micro); }.wrong-summary>svg { width:17px; color:var(--text-secondary-color); transition:transform .18s ease; }.wrong-summary>svg.rotated { transform:rotate(180deg); }.wrong-detail { display:flex; flex-direction:column; gap:11px; padding:2px 12px 14px 29px; }.answer-note,.diagnosis-note,.explanation-note { padding:11px 12px; border-radius:var(--radius-inset); background:var(--surface-muted); }.answer-note { display:flex; align-items:center; gap:8px; }.answer-note span,.diagnosis-note>span,.explanation-note>span { color:var(--text-secondary-color); font-size:var(--type-size-caption); }.answer-note strong { color:var(--green-color); }.diagnosis-note { background:var(--color-warning-soft); }.diagnosis-note strong { display:block; margin-top:4px; font-size:var(--type-size-body); }.diagnosis-note p { margin:4px 0 0; color:var(--text-color); font-size:var(--type-size-body); line-height:1.62; }.diagnosis-retry { margin-top:8px; min-height:32px; border:0; border-radius:var(--radius-inset); padding:0 10px; color:var(--orange-color); background:rgba(var(--color-ink-rgb),.05); font:inherit; font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }.diagnosis-retry:disabled { opacity:.55; }.explanation-note { display:flex; flex-direction:column; gap:6px; }.reveal-button { min-height:40px; display:inline-flex; align-items:center; justify-content:center; gap:7px; border:0; border-radius:var(--radius-control); color:var(--primary-color); background:var(--color-brand-soft); font:inherit; font-size:var(--type-size-secondary); font-weight:var(--type-weight-semibold); }.filter-form { display:flex; flex-direction:column; gap:12px; }.filter-form label { display:flex; flex-direction:column; gap:6px; }.filter-form span { color:var(--text-secondary-color); font-size:var(--type-size-caption); }.filter-options { display:flex; flex-wrap:wrap; gap:7px; }.filter-options button { min-height:32px; border:0; border-radius:var(--radius-pill); padding:0 11px; background:var(--surface-control); color:var(--text-secondary-color); font:inherit; font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }.filter-options button.active { background:rgba(var(--color-brand-rgb),.12); color:var(--primary-color); }.flashcard-top { display:flex; justify-content:space-between; gap:8px; color:var(--orange-color); font-size:var(--type-size-caption); }.flashcard-top small { color:var(--text-secondary-color); }.flashcard-actions { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }.flashcard-actions button { min-height:39px; border:0; border-radius:var(--radius-control); color:var(--text-color); background:var(--surface-control); font:inherit; font-size:var(--type-size-secondary); }.flashcard-actions button:nth-child(2) { color:var(--color-text-inverse); background:var(--primary-color); font-weight:var(--type-weight-semibold); }.flashcard-actions button:disabled { opacity:.4; }
.sync-error { margin:0; color:var(--red-color); font-size:var(--type-size-micro); text-align:center; }
.review-workspace { display:flex; flex-direction:column; gap:10px; }
.review-intro { margin:0; color:var(--text-secondary-color); font-size:var(--type-size-caption); line-height:1.55; }
.review-toolbar { min-height:32px; display:flex; align-items:center; justify-content:space-between; gap:8px; }
.review-count { color:var(--primary-color); font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); white-space:nowrap; font-variant-numeric:tabular-nums; }
.review-cap { margin:0; padding:8px 10px; border-radius:var(--radius-inset); color:var(--orange-color); background:var(--color-warning-soft); font-size:var(--type-size-caption); line-height:1.5; }
.review-select-all { min-height:30px; flex:0 0 auto; display:inline-flex; align-items:center; gap:7px; padding:0 2px; border:0; color:var(--text-secondary-color); background:transparent; font:inherit; font-size:var(--type-size-caption); white-space:nowrap; }
/* Smaller than a row checkbox so the control never reads as one more selected item. */
.review-select-all .review-check { width:17px; height:17px; margin-top:0; border-radius:5px; }
.review-select-all .review-check svg { width:12px; }
.review-select-all .review-check.selected { border-color:var(--primary-color); background:var(--primary-color); }
.review-list { overflow:hidden; border-radius:var(--radius-card); background:var(--surface-card); }
.review-list>button { width:100%; min-height:62px; display:flex; align-items:flex-start; gap:10px; padding:11px; border:0; border-top:1px solid var(--border-subtle); color:inherit; background:transparent; text-align:left; }
.review-list>button:first-child { border-top:0; }
.review-list>button.selected { background:rgba(var(--color-brand-rgb),.055); }
.review-list>button:disabled { opacity:.42; }
.review-check { width:20px; height:20px; margin-top:1px; flex:0 0 auto; display:grid; place-items:center; border:1.5px solid rgba(var(--color-ink-rgb),.18); border-radius:6px; color:var(--color-text-inverse); }
.selected .review-check { border-color:var(--primary-color); background:var(--primary-color); }
.review-check svg { width:14px; }
.review-copy { min-width:0; display:flex; flex:1; flex-direction:column; gap:4px; }
/* Two lines: one truncated line makes near-identical stems impossible to tell apart. */
.review-copy strong { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; color:var(--text-color); font-size:var(--type-size-body); font-weight:var(--type-weight-medium); line-height:1.5; }
.review-copy small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary-color); font-size:var(--type-size-micro); }
.start-review { flex:1; display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:46px; font-weight:var(--type-weight-semibold); }
.start-review svg { width:17px; height:17px; }
</style>
