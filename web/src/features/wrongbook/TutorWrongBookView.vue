<template>
  <div class="tutor-wrongbook app-page">
    <PageHeader title="错题本" :meta="loading ? '正在同步学习事实' : `${entries.length} 道待巩固`">
      <template #actions>
        <button class="header-icon" type="button" aria-label="筛选错题" @click="showFilter = true"><FilterIcon /></button>
        <button class="header-icon" type="button" aria-label="打开错题闪卡" :disabled="!filtered.length" @click="openFlashcard"><LayersIcon /></button>
      </template>
    </PageHeader>

    <PullToRefresh class="wrongbook-scroll" :on-refresh="load">
      <AppStateView v-if="loading" state="loading" title="正在读取错题" />
      <AppStateView v-else-if="error" state="error" title="错题暂不可用" :description="error" action-label="重试" @action="load" />
      <AppStateView
        v-else-if="!filtered.length"
        state="success"
        :title="entries.length ? '当前筛选下没有错题' : '暂无待巩固错题'"
        :description="entries.length ? '调整筛选条件，或继续完成新的针对性练习。' : '每次提交后，答错题会自动写入这里。'"
      />

      <section v-else class="wrong-list" aria-label="错题列表">
        <article v-for="entry in filtered" :key="entry.id" :class="['wrong-entry', { expanded: expandedId === entry.id }]">
          <button class="wrong-summary" type="button" @click="toggle(entry.id)">
            <span class="cause-dot"></span>
            <span class="wrong-copy"><strong>{{ cause(entry) }}</strong><em>{{ summary(entry.question.content.prompt) }}</em><small>{{ entry.question.sequence }} 题 · {{ entry.session.sessionType === 'review' ? '复习训练' : '独立练习' }} · {{ formatTime(entry.attempt.submittedAt) }}</small></span>
            <ChevronDownIcon :class="{ rotated: expandedId === entry.id }" />
          </button>
          <div v-if="expandedId === entry.id" class="wrong-detail">
            <ContentDocumentRenderer :document="entry.question.content.material || entry.question.content.prompt" markdown-variant="compact" />
            <ContentDocumentRenderer v-if="entry.question.content.material" :document="entry.question.content.prompt" markdown-variant="compact" />
            <section class="answer-note"><span>正确答案</span><strong>{{ entry.question.content.correctOptionId }}</strong></section>
            <section class="diagnosis-note"><span>错因分析</span><template v-if="entry.diagnoses.length"><strong>{{ cause(entry) }}</strong><p>{{ detail(entry) }}</p></template><p v-else>正在结合本题作答过程分析错因，完成后会自动显示。</p></section>
            <section class="explanation-note"><span>解析</span><ContentDocumentRenderer :document="entry.question.content.explanation" markdown-variant="compact" /></section>
            <button class="retry-button" type="button" @click="retry(entry)"><RotateCcwIcon />重新作答本题组</button>
          </div>
        </article>
      </section>
    </PullToRefresh>

    <BottomSheet v-model="showFilter" title="错题筛选" subtitle="按训练模块与已确认错因过滤" variant="filter">
      <div class="filter-form">
        <label>
          <span>训练模块</span>
          <div class="filter-options">
            <button type="button" :class="{ active: moduleFilter === '' }" @click="moduleFilter = ''">全部模块</button>
            <button v-for="module in modules" :key="module" type="button" :class="{ active: moduleFilter === module }" @click="moduleFilter = module">{{ module }}</button>
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
        <ContentDocumentRenderer :document="flashcard.question.content.material || flashcard.question.content.prompt" markdown-variant="compact" />
        <ContentDocumentRenderer v-if="flashcard.question.content.material" :document="flashcard.question.content.prompt" markdown-variant="compact" />
        <button class="reveal-button" type="button" @click="revealed = !revealed">{{ revealed ? '收起答案与解析' : '查看答案与解析' }}</button>
        <template v-if="revealed"><section class="answer-note"><span>正确答案</span><strong>{{ flashcard.question.content.correctOptionId }}</strong></section><section class="diagnosis-note"><span>错因分析</span><p>{{ detail(flashcard) }}</p></section><ContentDocumentRenderer :document="flashcard.question.content.explanation" markdown-variant="compact" /></template>
        <div class="flashcard-actions"><button type="button" :disabled="flashcardIndex === 0" @click="flashcardIndex--">上一张</button><button type="button" @click="retry(flashcard)">重做</button><button type="button" :disabled="flashcardIndex >= filtered.length - 1" @click="flashcardIndex++">下一张</button></div>
      </template>
    </CenterDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronDownIcon, FilterIcon, LayersIcon, RotateCcwIcon } from 'lucide-vue-next';
import { AppStateView, PullToRefresh } from '@/capabilities/design-system/public';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import CenterDialog from '@/components/layout/CenterDialog.vue';
import ContentDocumentRenderer from '@/components/content/ContentDocumentRenderer.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import { initializeTutorRuntime } from '@/composition-root/public';
import { errorCauseLabel, type WrongBookDiagnosis, type WrongBookEntry } from '@/modules/evidence/public';
import type { ContentDocument } from '@/modules/content/public';

const router = useRouter();
const loading = ref(true); const error = ref(''); const entries = ref<readonly WrongBookEntry[]>([]);
const expandedId = ref<string>(); const showFilter = ref(false); const showFlashcards = ref(false); const flashcardIndex = ref(0); const revealed = ref(false);
const moduleFilter = ref(''); const causeFilter = ref('');
const modules = computed(() => [...new Set(entries.value.map((entry) => entry.module).filter(Boolean))].sort());
const causes = computed(() => [...new Set(entries.value.map(cause))].sort());
const filtered = computed(() => entries.value.filter((entry) => (!moduleFilter.value || entry.module === moduleFilter.value) && (!causeFilter.value || cause(entry) === causeFilter.value)));
const flashcard = computed(() => filtered.value[flashcardIndex.value]);

onMounted(() => { void load(); });
watch(filtered, () => { if (flashcardIndex.value >= filtered.value.length) flashcardIndex.value = Math.max(0, filtered.value.length - 1); });
watch(flashcardIndex, () => { revealed.value = false; });

async function load() {
  loading.value = true; error.value = '';
  try {
    const runtime = await initializeTutorRuntime(); const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先完成备考档案。');
    entries.value = await runtime.getWrongBookEntries.execute({ examCycleId: cycle.examCycle.id, limit: 80 });
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取错题失败'; }
  finally { loading.value = false; }
}
function toggle(id: string) { expandedId.value = expandedId.value === id ? undefined : id; }
function cause(entry: WrongBookEntry): string { return errorCauseLabel[effectiveDiagnosis(entry)?.causeCode as keyof typeof errorCauseLabel] || '错因待分析'; }
function detail(entry: WrongBookEntry): string { return effectiveDiagnosis(entry)?.detail || '正在结合本题作答过程分析错因，完成后会自动显示。'; }
function effectiveDiagnosis(entry: WrongBookEntry): WrongBookDiagnosis | undefined { return [...entry.diagnoses].sort((left, right) => diagnosisPriority(right) - diagnosisPriority(left) || right.diagnosis.createdAt - left.diagnosis.createdAt)[0]; }
function diagnosisPriority(value: WrongBookDiagnosis): number { return value.diagnosis.source === 'tutor_ai' ? 2 : value.causeCode === 'unknown' ? 0 : 1; }
function summary(document: ContentDocument): string { const text = collectText(document).replace(/\s+/g, ' ').trim(); return text.length > 46 ? `${text.slice(0, 46)}...` : text || '题目内容'; }
function collectText(document: ContentDocument): string { return document.blocks.map((block) => block.type === 'markdown' ? block.source : block.type === 'callout' ? collectText({ schemaVersion: document.schemaVersion, blocks: block.blocks }) : block.type === 'data_table' ? `${block.caption || ''} ${block.rows.map((row) => Object.values(row).join(' ')).join(' ')}` : block.type === 'formula' ? block.source : block.type === 'svg_diagram' ? block.alt : block.type === 'image' ? block.alt : '').join(' '); }
function formatTime(value: number): string { return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }); }
function openFlashcard() { flashcardIndex.value = 0; revealed.value = false; showFlashcards.value = true; }
function retry(entry: WrongBookEntry) { showFlashcards.value = false; void router.push({ path: '/vue/practice/objective-session', query: { questionSetId: entry.session.questionSetId, learningThreadId: entry.session.learningThreadId, retryFrom: entry.id } }); }
</script>

<style scoped>
.wrongbook-scroll { display:flex; flex-direction:column; gap:12px; padding-top:12px; }.header-icon { width:36px; height:36px; display:grid; place-items:center; border:0; border-radius:50%; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.1); }.header-icon:disabled { opacity:.4; }.header-icon svg { width:17px; height:17px; }.wrong-list { overflow:hidden; border-radius:8px; background:rgba(var(--color-surface-rgb),.52); }.wrong-entry { border-top:1px solid rgba(var(--color-ink-rgb),.055); }.wrong-entry:first-child { border-top:0; }.wrong-summary { width:100%; min-height:72px; display:flex; align-items:center; gap:10px; padding:11px 12px; border:0; background:transparent; color:inherit; text-align:left; }.cause-dot { width:9px; height:9px; border-radius:50%; background:var(--orange-color); flex:0 0 auto; }.wrong-copy { min-width:0; flex:1; display:flex; flex-direction:column; gap:3px; }.wrong-copy strong,.wrong-copy em,.wrong-copy small { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }.wrong-copy strong { font-size:var(--type-size-body); }.wrong-copy em,.wrong-copy small { color:var(--text-secondary-color); font-size:var(--type-size-caption); font-style:normal; }.wrong-copy small { font-size:var(--type-size-micro); }.wrong-summary>svg { width:17px; color:var(--text-secondary-color); transition:transform .18s ease; }.wrong-summary>svg.rotated { transform:rotate(180deg); }.wrong-detail { display:flex; flex-direction:column; gap:11px; padding:2px 12px 14px 31px; }.answer-note,.diagnosis-note,.explanation-note { padding:10px 11px; border-radius:8px; background:rgba(var(--color-ink-rgb),.035); }.answer-note { display:flex; align-items:center; gap:8px; }.answer-note span,.diagnosis-note>span,.explanation-note>span { color:var(--text-secondary-color); font-size:var(--type-size-caption); }.answer-note strong { color:var(--green-color); }.diagnosis-note { background:rgba(255,149,0,.075); }.diagnosis-note strong { display:block; margin-top:4px; font-size:var(--type-size-secondary); }.diagnosis-note p { margin:4px 0 0; color:var(--text-secondary-color); font-size:var(--type-size-secondary); line-height:1.5; }.explanation-note { display:flex; flex-direction:column; gap:6px; }.retry-button,.reveal-button { min-height:40px; display:inline-flex; align-items:center; justify-content:center; gap:7px; border:0; border-radius:10px; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.1); font:inherit; font-size:var(--type-size-secondary); }.retry-button svg { width:16px; }.filter-form { display:flex; flex-direction:column; gap:12px; }.filter-form label { display:flex; flex-direction:column; gap:6px; }.filter-form span { color:var(--text-secondary-color); font-size:var(--type-size-caption); }.filter-options { display:flex; flex-wrap:wrap; gap:7px; }.filter-options button { min-height:32px; border:0; border-radius:999px; padding:0 11px; background:var(--surface-control); color:var(--text-secondary-color); font:inherit; font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }.filter-options button.active { background:rgba(var(--color-brand-rgb),.12); color:var(--primary-color); }.flashcard-top { display:flex; justify-content:space-between; gap:8px; color:var(--orange-color); font-size:var(--type-size-caption); }.flashcard-top small { color:var(--text-secondary-color); }.flashcard-actions { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }.flashcard-actions button { min-height:39px; border:0; border-radius:9px; color:var(--text-color); background:var(--surface-control); font:inherit; font-size:var(--type-size-secondary); }.flashcard-actions button:nth-child(2) { color:#fff; background:var(--primary-color); }.flashcard-actions button:disabled { opacity:.4; }
</style>
