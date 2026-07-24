<template>
  <div class="tutor-session app-page">
    <PageHeader :title="`${index + 1}/${bundle?.questions.length || 0}`" :meta="submitted ? '批改结果' : `${answeredCount}/${bundle?.questions.length || 0} 已作答`">
      <template #actions>
        <button class="answer-card-button" type="button" @click="showAnswerCard = true"><ListChecksIcon /></button>
        <HeaderMoreMenu title="做题操作" subtitle="计划、中心和复盘入口">
          <button class="menu-row" type="button" @click="router.push('/vue/plan')"><CalendarCheckIcon />每日计划</button>
          <button class="menu-row" type="button" @click="router.push('/vue/practice')"><LayoutGridIcon />刷题中心</button>
          <button class="menu-row" type="button" @click="router.push('/vue/practice/session')"><SparklesIcon />自定义刷题</button>
          <button class="menu-row" type="button" @click="router.push('/vue/wrongbook')"><BookMarkedIcon />错题复盘</button>
          <button class="menu-row" type="button" @click="router.push('/vue/study')"><BookOpenIcon />学习中心</button>
        </HeaderMoreMenu>
      </template>
    </PageHeader>

    <main v-if="question" class="app-page-scroll session-scroll">
      <ContentDocumentRenderer v-if="question.content.material" :document="question.content.material" markdown-variant="compact" />
      <ContentDocumentRenderer :document="question.content.prompt" />
      <div class="options">
        <button v-for="option in question.content.options" :key="option.id" :class="optionClass(option.id)" type="button" :disabled="submitted" @click="selectOption(option.id)">
          <b>{{ option.id }}</b><ContentDocumentRenderer :document="option.content" markdown-variant="compact" />
        </button>
      </div>
      <section v-if="submitted" class="explanation"><strong>解析</strong><ContentDocumentRenderer :document="question.content.explanation" markdown-variant="compact" /></section>
      <section v-if="submitted" class="diagnosis" :class="{ pending: diagnosing }"><strong>错因分析</strong><template v-if="diagnosisFor(question.id)"><b>{{ diagnosisLabel(question.id) }}</b><p>{{ diagnosisFor(question.id)?.detail }}</p></template><p v-else>{{ diagnosing ? '正在结合你的作答过程分析错因...' : '本题作答正确，继续保持。' }}</p></section>
      <p v-if="error" class="session-error">{{ error }}</p>
    </main>
    <main v-else class="session-empty">{{ error || '正在读取题目...' }}</main>

    <footer v-if="bundle" class="session-actions">
      <button :disabled="index === 0" @click="index--">上一题</button>
      <button v-if="index < bundle.questions.length - 1" :disabled="!submitted && !answers[question?.id || '']" @click="index++">下一题</button>
      <button v-else-if="submitted" @click="showAnswerCard = true">查看答题卡</button>
      <button v-else :disabled="submitting" @click="requestSubmit">{{ submitting ? '提交中...' : '交卷' }}</button>
    </footer>

    <CenterDialog v-model="showAnswerCard" title="答题卡" subtitle="点击题号可直接跳转" variant="content">
      <QuestionAnswerCard
        :questions="cardQuestions"
        :current-index="index"
        :answers="answers"
        :submitted="submitted"
        @select="goTo"
      />
    </CenterDialog>
    <ConfirmDialog v-model="showSubmitConfirm" title="确认交卷？" :description="unansweredCount ? `还有 ${unansweredCount} 题未作答，提交后将进入批改。` : '本组题目已全部作答，提交后将进入批改。'" confirm-text="确认交卷" @confirm="submit" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { BookMarkedIcon, BookOpenIcon, CalendarCheckIcon, LayoutGridIcon, ListChecksIcon, SparklesIcon } from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
import CenterDialog from '@/components/layout/CenterDialog.vue';
import ConfirmDialog from '@/components/layout/ConfirmDialog.vue';
import ContentDocumentRenderer from '@/components/content/ContentDocumentRenderer.vue';
import HeaderMoreMenu from '@/components/layout/HeaderMoreMenu.vue';
import QuestionAnswerCard, { type AnswerCardQuestionItem } from '@/components/question/QuestionAnswerCard.vue';
import { createConfiguredProviderGateway, initializeTutorRuntime } from '@/composition-root/public';
import type { CommittedQuestionSetBundle } from '@/modules/content/public';
import { errorCauseLabel, type ErrorDiagnosisRecord, type ObjectiveSessionReview } from '@/modules/evidence/public';

const route = useRoute();
const router = useRouter();
const bundle = ref<CommittedQuestionSetBundle>();
const error = ref(''); const index = ref(0); const answers = ref<Record<string, string>>({});
const submitted = ref(false); const submitting = ref(false); const showAnswerCard = ref(false); const showSubmitConfirm = ref(false);
const diagnosing = ref(false); const review = ref<ObjectiveSessionReview>();
const startedAt = Date.now(); const question = computed(() => bundle.value?.questions[index.value]);
const answeredCount = computed(() => bundle.value?.questions.filter((item) => !!answers.value[item.id]).length ?? 0);
const unansweredCount = computed(() => (bundle.value?.questions.length ?? 0) - answeredCount.value);

const cardQuestions = computed<AnswerCardQuestionItem[]>(() =>
  (bundle.value?.questions || []).map((item) => ({
    id: item.id,
    correctOptionId: item.content.correctOptionId
  }))
);

onMounted(() => { void load(); });
async function load() { try { const id = String(route.query.questionSetId || ''); if (!id) throw new Error('题组参数缺失。'); const runtime = await initializeTutorRuntime(); const value = await runtime.contentRepository.findQuestionSet(id as Parameters<typeof runtime.contentRepository.findQuestionSet>[0]); if (!value) throw new Error('题组不存在或已不可用。'); bundle.value = value; } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取题组失败'; } }
function selectOption(optionId: string) { if (!question.value || submitted.value) return; answers.value[question.value.id] = optionId; if (index.value < (bundle.value?.questions.length ?? 1) - 1) window.setTimeout(() => { index.value++; }, 220); }
function optionClass(optionId: string) { const selected = answers.value[question.value?.id ?? ''] === optionId; return { selected, correct: submitted.value && optionId === question.value?.content.correctOptionId, wrong: submitted.value && selected && optionId !== question.value?.content.correctOptionId }; }
function goTo(next: number) { index.value = next; showAnswerCard.value = false; }
function requestSubmit() { showSubmitConfirm.value = true; }
async function submit() { if (!bundle.value || submitting.value) return; showSubmitConfirm.value = false; const threadId = String(route.query.learningThreadId || bundle.value.questionSet.learningThreadId || ''); if (!threadId) { error.value = '学习主线参数缺失。'; return; } submitting.value = true; try { const runtime = await initializeTutorRuntime(); const reviewQueueItemId = String(route.query.reviewQueueItemId || '') || undefined; const result = await runtime.completeObjectivePractice.execute({ idempotencyKey: `practice:submit:${bundle.value.questionSet.id}:${Date.now()}`, learningThreadId: threadId as Parameters<typeof runtime.completeObjectivePractice.execute>[0]['learningThreadId'], questionSetId: bundle.value.questionSet.id, reviewQueueItemId: reviewQueueItemId as Parameters<typeof runtime.completeObjectivePractice.execute>[0]['reviewQueueItemId'], startedAt: startedAt as Parameters<typeof runtime.completeObjectivePractice.execute>[0]['startedAt'], elapsedMs: Date.now() - startedAt, answers: bundle.value.questions.map((item) => ({ questionId: item.id, optionId: answers.value[item.id] })) }); review.value = await runtime.getObjectiveSessionReview.execute(result.sessionId); submitted.value = true; index.value = 0; if (result.diagnosisRunIds.length) void runDiagnoses(result.sessionId); } catch (cause) { error.value = cause instanceof Error ? cause.message : '提交失败'; } finally { submitting.value = false; } }
async function runDiagnoses(sessionId: string) { diagnosing.value = true; try { const runtime = await initializeTutorRuntime(); await runtime.runTutorAgentBatch.execute({ workerId: `practice-session:${sessionId}`, gateway: await createConfiguredProviderGateway() }); review.value = await runtime.getObjectiveSessionReview.execute(sessionId as Parameters<typeof runtime.getObjectiveSessionReview.execute>[0]); } catch (cause) { error.value = cause instanceof Error ? `错因分析稍后重试：${cause.message}` : '错因分析稍后重试'; } finally { diagnosing.value = false; } }
function diagnosisFor(questionId: string): ErrorDiagnosisRecord | undefined { const item = review.value?.items.find((value) => value.question.id === questionId); return [...(item?.diagnoses ?? [])].sort((left, right) => diagnosisPriority(right) - diagnosisPriority(left) || right.createdAt - left.createdAt)[0]; }
function diagnosisLabel(questionId: string): string { const diagnosis = diagnosisFor(questionId); return diagnosis ? errorCauseLabel[diagnosis.causeCode] : ''; }
function diagnosisPriority(diagnosis: ErrorDiagnosisRecord): number { return diagnosis.source === 'tutor_ai' ? 2 : diagnosis.causeCode === 'unknown' ? 0 : 1; }
</script>

<style scoped>
.session-scroll { display:flex; flex-direction:column; gap:16px; padding-top:12px; padding-bottom:76px; }.answer-card-button { width:36px; height:36px; display:grid; place-items:center; border:0; border-radius:50%; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.1); }.answer-card-button svg { width:17px; height:17px; }.options { display:flex; flex-direction:column; gap:7px; }.options button { display:flex; align-items:flex-start; gap:9px; padding:10px; border:0; border-radius:8px; background:rgba(var(--color-ink-rgb),.035); color:inherit; text-align:left; }.options button.selected { background:rgba(var(--color-brand-rgb),.11); }.options button.correct { background:rgba(52,199,89,.14); }.options button.wrong { background:rgba(255,59,48,.12); }.options b { width:22px; height:22px; display:grid; place-items:center; border-radius:50%; background:rgba(var(--color-ink-rgb),.08); font-size:var(--type-size-caption); flex:0 0 auto; }.explanation,.diagnosis { padding:12px; border-radius:8px; background:rgba(var(--color-ink-rgb),.035); }.explanation strong,.diagnosis strong { display:block; margin-bottom:8px; }.diagnosis { background:rgba(255,149,0,.075); }.diagnosis.pending { animation:diagnosis-pulse 1.2s ease-in-out infinite; }.diagnosis b { display:block; font-size:var(--type-size-secondary); }.diagnosis p { margin:4px 0 0; color:var(--text-secondary-color); font-size:var(--type-size-secondary); line-height:1.5; }@keyframes diagnosis-pulse { 50% { opacity:.62; } }.session-error { margin:0; color:var(--red-color); font-size:var(--type-size-caption); }.session-actions { position:fixed; left:0; right:0; bottom:0; display:flex; gap:8px; padding:8px max(12px,env(safe-area-inset-left)) calc(8px + env(safe-area-inset-bottom)); background:rgba(250,251,253,.9); backdrop-filter:blur(14px); }.session-actions button { flex:1; height:40px; border:0; border-radius:10px; background:rgba(var(--color-ink-rgb),.08); color:var(--text-color); font:inherit; }.session-actions button:last-child { background:var(--primary-color); color:#fff; }.session-actions button:disabled { opacity:.45; }.session-empty { display:grid; place-items:center; min-height:50vh; color:var(--text-secondary-color); padding:20px; text-align:center; }.answer-card-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; }.answer-card-grid button { height:36px; border:0; border-radius:9px; color:var(--text-secondary-color); background:rgba(var(--color-ink-rgb),.06); font:inherit; }.answer-card-grid button.answered { color:var(--primary-color); background:rgba(var(--color-brand-rgb),.12); }.answer-card-grid button.active { outline:2px solid var(--primary-color); outline-offset:1px; }.answer-card-grid button.wrong { color:var(--red-color); background:rgba(255,59,48,.12); }
</style>
