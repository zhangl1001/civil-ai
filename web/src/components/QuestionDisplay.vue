<template>
  <QuestionTemplateLayout
    :template="renderTemplate"
    :class="['question-container', { 'graphic-question': isGraphicQuestion, 'reading-question': isReadingQuestion }]"
    :show-meta="!isReadingQuestion"
    :show-material="isReadingQuestion"
    :show-question="!isReadingQuestion"
    :show-answer="!isReadingQuestion"
    :show-grading="false"
    :show-explanation="false"
  >
    <template #meta>
      <div class="question-meta">
        <span class="type-tag">{{ typeText }}</span>
        <span v-if="difficultyLabel" class="difficulty-tag">{{ difficultyLabel }}</span>
        <span v-if="question.knowledgePoint" class="source-tag">{{ question.knowledgePoint }}</span>
        <span v-if="sourceText" class="source-tag muted">{{ sourceText }}</span>
        <em>第 {{ questionNumber }} 题</em>
      </div>
    </template>
    <template #material>
      <section class="shared-material">
        <MarkdownContent class="material-md" :content="readingMaterialContent" :variant="isDataAnalysisQuestion ? 'data' : 'default'" />
      </section>
    </template>
    <template #question>
      <div class="stem">
        <span class="stem-index">{{ questionNumber }}.</span>
        <MarkdownContent class="stem-md" :content="question.stem" />
      </div>
    </template>
    <template #answer>
      <QuestionAnswerRegion
        :question="question"
        :user-answer="userAnswer"
        :is-submitted="isSubmitted"
        :graphic="isGraphicQuestion"
        :default-explanation-open="defaultExplanationOpen"
        :show-ai-analysis="showAiAnalysis"
        :grading-detail="gradingDetail"
        @select="selectOption"
        @ask-ai="$emit('askAi')"
      />
    </template>
    <template #overlay>
      <Transition name="reading-panel-slide">
        <section v-if="isReadingQuestion && showOptionSheet" class="reading-option-panel" :style="readingPanelStyle">
          <button class="reading-panel-handle" type="button" aria-label="拖动选项面板" @pointerdown="startPanelDrag">
            <i></i>
          </button>
        <QuestionAnswerRegion
          :question="question"
          :user-answer="userAnswer"
          :is-submitted="isSubmitted"
          variant="sheet"
          show-question-prompt
          :question-label="readingQuestionLabel"
          :default-explanation-open="defaultExplanationOpen"
          :show-ai-analysis="showAiAnalysis"
          :grading-detail="gradingDetail"
          @select="selectOption"
          @ask-ai="$emit('askAi')"
        />
        </section>
      </Transition>
    </template>
  </QuestionTemplateLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Question } from '@/stores/practice';
import MarkdownContent from '@/components/MarkdownContent.vue';
import QuestionAnswerRegion from '@/components/question/QuestionAnswerRegion.vue';
import QuestionTemplateLayout from '@/components/question/QuestionTemplateLayout.vue';
import { QUESTION_RENDER_TEMPLATES } from '@/domain/question';
import { normalizeQuestionTextBlock, resolveQuestionRenderTemplate } from '@/domain/questionPresentation';

const props = defineProps<{
  question: Question;
  questionNumber: number;
  userAnswer: number | null;
  isSubmitted: boolean;
  difficulty?: string;
  questionType?: string;
  defaultExplanationOpen?: boolean;
  showAiAnalysis?: boolean;
  gradingDetail?: {
    errorType?: string;
    errorDetail?: string;
    correctApproach?: string;
    tips?: string;
    aiAnalysisTaskId?: string;
  };
}>();

const emit = defineEmits<{
  select: [index: number];
  askAi: [];
}>();

const showOptionSheet = ref(false);
const readingPanelHeight = ref(260);
let panelDragging = false;

const typeText = computed(() => {
  if (props.questionType) return props.questionType;
  const map: Record<string, string> = {
    single: '单选题',
    multiple: '多选题',
    essay: '主观题',
    unknown: '练习题'
  };
  return map[props.question.type] || '练习题';
});

const difficultyLabel = computed(() => props.difficulty || '');
const renderTemplate = computed(() => resolveQuestionRenderTemplate(props.question));
const isGraphicQuestion = computed(() => renderTemplate.value === QUESTION_RENDER_TEMPLATES.GRAPHIC);
const isDataAnalysisQuestion = computed(() => renderTemplate.value === QUESTION_RENDER_TEMPLATES.DATA_ANALYSIS);
const isReadingQuestion = computed(() => isDataAnalysisQuestion.value || renderTemplate.value === QUESTION_RENDER_TEMPLATES.SHARED_MATERIAL);

const sourceText = computed(() => {
  if (props.question.sourceDate) return props.question.sourceDate;
  if (!props.question.sourceFile) return '';
  if (props.question.sourceFile === 'dev-seed') return '内置题';
  if (props.question.sourceFile.startsWith('task_') || props.question.sourceFile.startsWith('ai_')) return 'AI 生成';
  return '题库';
});

const readingQuestionLabel = computed(() => props.question.subQuestionIndex && props.question.subQuestionCount
  ? `第 ${props.question.subQuestionIndex}/${props.question.subQuestionCount} 小题`
  : `第 ${props.questionNumber} 题`);
const readingMaterialContent = computed(() => normalizeQuestionTextBlock(props.question.material));
const readingPanelStyle = computed(() => ({
  height: `${readingPanelHeight.value}px`
}));
watch(
  () => [props.question.id, props.isSubmitted],
  () => {
    showOptionSheet.value = isReadingQuestion.value;
    readingPanelHeight.value = 260;
  }
);

watch(isReadingQuestion, (value) => {
  showOptionSheet.value = value;
}, { immediate: true });

function selectOption(index: number) {
  if (props.isSubmitted) return;
  emit('select', index);
  if (isReadingQuestion.value) showOptionSheet.value = false;
}

function startPanelDrag(event: PointerEvent) {
  panelDragging = true;
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', handlePanelDrag);
  window.addEventListener('pointerup', stopPanelDrag, { once: true });
}

function handlePanelDrag(event: PointerEvent) {
  if (!panelDragging) return;
  const viewportHeight = window.innerHeight || 700;
  const nextHeight = Math.round(viewportHeight - event.clientY - 12);
  readingPanelHeight.value = Math.min(Math.max(nextHeight, 178), Math.min(430, viewportHeight * 0.68));
}

function stopPanelDrag() {
  panelDragging = false;
  window.removeEventListener('pointermove', handlePanelDrag);
}

onBeforeUnmount(() => {
  stopPanelDrag();
});
</script>

<style scoped>
.question-container {
  width: 100%;
  max-width: 100%;
  min-height: 100%;
  min-width: 0;
  padding: 10px 4px 14px;
  border: none;
  border-radius: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: transparent;
  box-shadow: none;
  overflow-x: hidden;
}
.graphic-question {
  max-width: 100%;
  overflow-x: hidden;
  touch-action: pan-y;
}
.graphic-question :deep(.template-region),
.graphic-question :deep(.markdown-content),
.graphic-question :deep(.stem-md) {
  min-width: 0;
  max-width: 100%;
  overflow-x: hidden;
}
.question-meta {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 22px;
  overflow: hidden;
}
.question-meta span,
.question-meta em {
  flex-shrink: 0;
  max-width: 42%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.question-meta em {
  margin-left: auto;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}
.type-tag,
.difficulty-tag,
.source-tag {
  padding: 3px 9px;
  border-radius: 999px;
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .1);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.difficulty-tag {
  color: #6f42c1;
  background: rgba(126, 87, 194, .1);
}
.source-tag {
  color: #8a5a00;
  background: rgba(232, 150, 10, .12);
}
.source-tag.muted {
  color: var(--text-secondary-color);
  background: rgba(var(--color-ink-rgb), .055);
}
.stem {
  font-size: var(--type-size-body-large);
  line-height: 1.72;
  margin: 0;
  font-weight: var(--type-weight-regular);
  padding: 0 4px;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: #262b33;
}
.shared-material {
  padding: 0 4px 8px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.reading-question .shared-material {
  max-height: calc(100dvh - 330px);
  min-height: 150px;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.shared-material > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.shared-material strong {
  color: var(--text-color);
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
.shared-material span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.material-md {
  color: #262b33;
  font-size: var(--type-size-body-large);
  line-height: 1.78;
}
.stem-index {
  flex-shrink: 0;
  color: #5f6673;
  font-weight: var(--type-weight-semibold);
}
.stem-md {
  min-width: 0;
  width: 100%;
}
.stem-md :deep(p),
.option-text :deep(p) {
  margin: 0;
}
.stem-md :deep(p + p),
.option-text :deep(p + p) {
  margin-top: 6px;
}
.options-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.option-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  border-radius: 9px;
  background: rgba(255, 255, 255, .16);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.option-item + .option-item {
  box-shadow: none;
}
.option-item:active {
  transform: scale(.985);
}
.option-item.selected {
  background: rgba(var(--color-brand-rgb), .055);
  box-shadow: inset 2px 0 0 var(--primary-color);
}
.option-item.correct {
  background: rgba(52, 168, 83, .07);
  color: #1e8e3e;
  box-shadow: inset 2px 0 0 var(--green-color);
}
.option-item.incorrect {
  background: rgba(255, 59, 48, .065);
  color: #d93025;
  box-shadow: inset 2px 0 0 var(--red-color);
}
.option-letter {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--color-ink-rgb), .035);
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
  flex-shrink: 0;
}
.option-item.selected .option-letter {
  color: #fff;
  background: var(--primary-color);
}
.option-item.correct .option-letter {
  color: #fff;
  background: var(--green-color);
}
.option-item.incorrect .option-letter {
  color: #fff;
  background: var(--red-color);
}
.option-text {
  min-width: 0;
  overflow: visible;
  line-height: 1.58;
  padding-top: 1px;
  font-size: var(--type-size-body-large);
  font-weight: var(--type-weight-regular);
  color: #303642;
  flex: 1;
}
.reading-question .stem {
  padding-bottom: 8px;
}
.reading-question .stem-md {
  max-height: none;
}
.reading-option-trigger {
  min-height: 42px;
  border: none;
  border-radius: 999px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: rgba(255, 255, 255, .22);
  color: var(--text-color);
  font: inherit;
  font-weight: var(--type-weight-semibold);
}
.reading-option-trigger em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}
.reading-options {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.reading-options .option-item {
  min-height: 48px;
  padding: 10px 12px;
}
.reading-option-panel {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 72;
  max-height: min(68dvh, 430px);
  min-height: 178px;
  border-radius: 18px 18px 0 0;
  padding: 6px 14px calc(12px + var(--app-safe-bottom));
  display: flex;
  flex-direction: column;
  gap: 9px;
  background: rgba(250, 250, 250, .94);
  box-shadow: 0 -12px 28px rgba(28, 38, 58, .14);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}
.reading-panel-handle {
  width: 100%;
  height: 22px;
  border: none;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  touch-action: none;
}
.reading-panel-handle i {
  width: 38px;
  height: 4px;
  border-radius: 999px;
  background: rgba(var(--color-ink-rgb), .18);
}
.reading-sheet-stem {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.reading-sheet-stem strong {
  color: var(--text-color);
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
.reading-sheet-stem :deep(.markdown-content) {
  max-height: 70px;
  overflow-y: auto;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  line-height: 1.55;
}
.reading-option-panel .reading-options {
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 2px;
  -webkit-overflow-scrolling: touch;
}
.reading-panel-slide-enter-active,
.reading-panel-slide-leave-active {
  transition: transform .18s ease, opacity .18s ease;
}
.reading-panel-slide-enter-from,
.reading-panel-slide-leave-to {
  transform: translateY(18px);
  opacity: 0;
}
.stem-md :deep(svg),
.stem-md :deep(img) {
  display: block;
  width: min(100%, 326px);
  max-height: 188px;
  margin: 8px auto 10px;
  padding: 8px;
  box-sizing: border-box;
  object-fit: contain;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.graphic-question .stem-md :deep(svg),
.graphic-question .stem-md :deep(img) {
  width: 100%;
  max-width: 100%;
  height: auto;
  max-height: 176px;
  padding: 6px;
  object-fit: contain;
  overflow: hidden;
}
.graphic-question .stem-md :deep(p:has(svg)),
.graphic-question .stem-md :deep(p:has(img)) {
  display: block;
  width: 100%;
}
.option-text :deep(svg),
.option-text :deep(img) {
  display: block;
  width: min(100%, 132px);
  max-height: 74px;
  margin: 0;
  padding: 5px;
  box-sizing: border-box;
  object-fit: contain;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.graphic-question .option-text :deep(svg),
.graphic-question .option-text :deep(img) {
  width: min(100%, 122px);
  max-height: 68px;
  padding: 4px;
}
.option-text :deep(p:has(svg)) {
  display: flex;
  align-items: center;
  min-height: 78px;
}
.option-text :deep(p:has(img)) {
  display: flex;
  align-items: center;
  min-height: 78px;
}
@media (max-width: 380px) {
  .stem-md :deep(svg),
  .stem-md :deep(img) {
    max-height: 168px;
  }
  .graphic-question .stem-md :deep(svg),
  .graphic-question .stem-md :deep(img) {
    max-height: 154px;
  }
  .option-text :deep(svg),
  .option-text :deep(img) {
    width: min(100%, 118px);
    max-height: 66px;
  }
}
.option-item.correct .option-text,
.option-item.incorrect .option-text {
  font-weight: var(--type-weight-medium);
}
.ask-ai-btn {
  flex-shrink: 0;
  min-height: 28px;
  border: none;
  border-radius: 9px;
  padding: 0 10px;
  color: var(--text-secondary-color);
  background: rgba(var(--color-ink-rgb), .06);
  font-family: inherit;
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.wrong-cause-card {
  margin-top: -3px;
  padding: 11px 12px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(255, 59, 48, .13), rgba(255, 255, 255, .76));
  box-shadow: inset 3px 0 0 var(--red-color), 0 8px 20px rgba(217, 48, 37, .08);
}
.wrong-cause-card div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wrong-cause-loading {
  margin-bottom: 9px;
  padding: 8px 9px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 9px;
  background: rgba(255, 255, 255, .38);
}
.wrong-cause-card .wrong-cause-loading em {
  margin: 0;
  padding: 0;
  border: 0;
  color: #8a3b24;
  font-size: var(--type-size-caption);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}
.cat-face {
  position: relative;
  width: 26px;
  height: 22px;
  border-radius: 12px 12px 10px 10px;
  background: #fff4e8;
  box-shadow: inset 0 0 0 1px rgba(138, 59, 36, .12);
  animation: cat-bob 1.05s ease-in-out infinite;
  flex-shrink: 0;
}
.cat-face::before,
.cat-face::after {
  content: '';
  position: absolute;
  top: -5px;
  width: 10px;
  height: 10px;
  background: #fff4e8;
  box-shadow: inset 0 0 0 1px rgba(138, 59, 36, .12);
  transform: rotate(45deg);
}
.cat-face::before { left: 3px; }
.cat-face::after { right: 3px; }
.cat-face i,
.cat-face b {
  position: absolute;
  top: 9px;
  width: 3px;
  height: 5px;
  border-radius: 999px;
  background: #8a3b24;
  animation: cat-blink 2.2s infinite;
}
.cat-face i { left: 8px; }
.cat-face b { right: 8px; }
.cat-face span {
  display: none;
}
@keyframes cat-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
@keyframes cat-blink {
  0%, 92%, 100% { transform: scaleY(1); }
  95% { transform: scaleY(.18); }
}
.wrong-cause-card strong {
  color: #c5221f;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
.wrong-cause-card span,
.wrong-cause-card em {
  color: #7f1d1d;
  font-size: var(--type-size-secondary);
  line-height: 1.55;
}
.wrong-cause-card em {
  display: block;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(217, 48, 37, .12);
  font-style: normal;
}
.explanation {
  margin-top: -1px;
  padding: 12px 13px;
  background: rgba(255, 255, 255, .34);
  border-radius: 12px;
  box-shadow: inset 2px 0 0 rgba(var(--color-brand-rgb), .16), 0 8px 18px rgba(var(--color-ink-rgb), .035);
  line-height: 1.65;
  font-size: var(--type-size-body);
}
.explanation-section + .explanation-section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(var(--color-ink-rgb), .045);
}
.explanation-section > strong {
  display: block;
  margin-bottom: 5px;
  color: #3d4654;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
.explanation-section :deep(p),
.explanation-section :deep(ol),
.explanation-section :deep(ul) {
  margin-top: 0;
  margin-bottom: 0;
}
.answer-toggle {
  width: 100%;
  min-height: 34px;
  border: none;
  border-radius: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 2px;
  color: var(--primary-color);
  background: transparent;
  font-family: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
  text-align: left;
}
.answer-toggle em {
  min-width: 0;
  margin-left: auto;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.answer-toggle.correct {
  color: var(--green-color);
  background: transparent;
}
.answer-toggle.wrong {
  color: var(--red-color);
  background: transparent;
}
.answer-toggle i {
  width: 8px;
  height: 8px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(45deg);
  transition: transform .16s ease;
}
.answer-toggle.open i {
  transform: rotate(225deg);
}
</style>
