<template>
  <QuestionTemplateLayout
    :class="['question-answer-region', `answer-region-${variant}`, { 'graphic-answer-region': graphic }]"
    template="answer_sheet"
    :show-question="showQuestionPrompt"
    :show-grading="showWrongCauseCard"
    :show-explanation="isSubmitted"
    :show-meta="false"
    :show-material="false"
  >
    <template #question>
      <section class="question-prompt-region">
      <strong v-if="questionLabel">{{ questionLabel }}</strong>
      <MarkdownContent :content="question.stem" />
      </section>
    </template>

    <template #answer>
      <section class="answer-options-region" aria-label="答题选项">
        <button
          v-for="(option, index) in question.options"
          :key="index"
          :class="getOptionClass(index)"
          type="button"
          :disabled="isSubmitted"
          @click="$emit('select', index)"
        >
          <span class="option-letter">{{ String.fromCharCode(65 + index) }}</span>
          <MarkdownContent class="option-text" :content="option" />
        </button>
      </section>
    </template>

    <template #grading>
      <section class="grading-region">
        <div v-if="showWrongCauseLoading" class="wrong-cause-loading" aria-hidden="true">
          <span class="cat-face"><i></i><b></b></span>
          <em>AI 小猫正在拆解错因</em>
        </div>
        <div class="grading-copy">
          <strong>{{ wrongCauseTitle }}</strong>
          <span>{{ wrongCauseText }}</span>
        </div>
        <em v-if="wrongCauseApproach">{{ wrongCauseApproach }}</em>
        <em v-if="wrongCauseTip">{{ wrongCauseTip }}</em>
      </section>
    </template>

    <template #explanation>
      <section class="explanation-region">
        <div class="review-actions">
          <button :class="['answer-toggle', answerStateClass, { open: explanationOpen }]" type="button" @click="explanationOpen = !explanationOpen">
            <span>{{ explanationOpen ? '收起解析' : '展开解析' }}</span>
            <i></i>
            <em>{{ answerSummary }}</em>
          </button>
          <button v-if="showAiAnalysis" class="ask-ai-btn" type="button" @click="$emit('askAi')">AI分析</button>
        </div>
        <div v-if="explanationOpen" class="explanation-content">
          <section v-for="section in explanationSections" :key="section.title" class="explanation-section">
            <strong>{{ section.title }}</strong>
            <MarkdownContent :content="section.content" />
          </section>
        </div>
      </section>
    </template>
  </QuestionTemplateLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import MarkdownContent from '@/components/MarkdownContent.vue';
import QuestionTemplateLayout from '@/components/question/QuestionTemplateLayout.vue';
import type { Question } from '@/stores/practice';

const props = withDefaults(defineProps<{
  question: Question;
  userAnswer: number | null;
  isSubmitted: boolean;
  variant?: 'inline' | 'sheet';
  graphic?: boolean;
  showQuestionPrompt?: boolean;
  questionLabel?: string;
  defaultExplanationOpen?: boolean;
  showAiAnalysis?: boolean;
  gradingDetail?: {
    errorType?: string;
    errorDetail?: string;
    correctApproach?: string;
    tips?: string;
    aiAnalysisTaskId?: string;
  };
}>(), {
  variant: 'inline',
  graphic: false,
  showQuestionPrompt: false,
  questionLabel: '',
  defaultExplanationOpen: false,
  showAiAnalysis: false,
  gradingDetail: undefined
});

defineEmits<{
  select: [index: number];
  askAi: [];
}>();

const explanationOpen = ref(Boolean(props.defaultExplanationOpen && props.isSubmitted));
const correctAnswerLabel = computed(() => String.fromCharCode(65 + props.question.answer));
const userAnswerLabel = computed(() => props.userAnswer === null ? '未作答' : String.fromCharCode(65 + props.userAnswer));
const answerSummary = computed(() => `你的答案 ${userAnswerLabel.value} · 正确答案 ${correctAnswerLabel.value}`);
const answerStateClass = computed(() => props.userAnswer === props.question.answer ? 'correct' : 'wrong');
const isWrongAnswer = computed(() => props.isSubmitted && props.userAnswer !== props.question.answer);
const cleanErrorType = computed(() => normalizeWrongCauseText(props.gradingDetail?.errorType, true));
const cleanErrorDetail = computed(() => normalizeWrongCauseText(props.gradingDetail?.errorDetail));
const showWrongCauseLoading = computed(() => Boolean(props.gradingDetail?.aiAnalysisTaskId && !cleanErrorDetail.value));
const showWrongCauseCard = computed(() => isWrongAnswer.value && Boolean(
  cleanErrorType.value || cleanErrorDetail.value || props.gradingDetail?.tips || props.gradingDetail?.aiAnalysisTaskId
));
const wrongCauseTitle = computed(() => cleanErrorType.value || (props.userAnswer === null ? '未作答' : '错因分析'));
const wrongCauseText = computed(() => {
  if (cleanErrorDetail.value) return cleanErrorDetail.value;
  if (props.gradingDetail?.aiAnalysisTaskId) return 'AI 正在分析这道错题的具体原因，完成后会自动更新到这里。';
  return props.userAnswer === null ? '这道题还没有作答，建议先补做再看解析。' : '这道题答错了，建议结合解析复盘关键条件和选项陷阱。';
});
const wrongCauseApproach = computed(() => props.gradingDetail?.correctApproach ? `正确思路：${props.gradingDetail.correctApproach}` : '');
const wrongCauseTip = computed(() => props.gradingDetail?.tips || '');
const explanationSections = computed(() => buildExplanationSections(
  props.question.explanation,
  correctAnswerLabel.value,
  props.question.knowledgePoint
));

watch(
  () => [props.question.id, props.isSubmitted],
  () => {
    explanationOpen.value = Boolean(props.defaultExplanationOpen && props.isSubmitted);
  }
);

function getOptionClass(index: number) {
  const classes = ['option-item'];
  if (props.isSubmitted) {
    if (index === props.question.answer) classes.push('correct');
    else if (index === props.userAnswer) classes.push('incorrect');
  } else if (index === props.userAnswer) {
    classes.push('selected');
  }
  return classes;
}

function buildExplanationSections(explanation: string, answerLabel: string, knowledgePoint?: string) {
  const raw = (explanation || '').trim();
  const sections: Array<{ title: string; content: string }> = [{ title: '答案', content: answerLabel }];
  const parsed = parseTitledSections(raw);
  if (parsed.length) sections.push(...parsed.filter((item) => item.title !== '答案' && item.content.trim()));
  else sections.push({ title: '解析', content: raw || '暂无解析' });
  if (knowledgePoint && !sections.some((item) => item.title.includes('考点'))) {
    sections.push({ title: '考点', content: knowledgePoint });
  }
  return sections;
}

function parseTitledSections(text: string) {
  const titles = ['解题步骤', '解析', '考点', '避坑', '错因', '正确思路', '答案'];
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?(${titles.join('|')})(?:\\*\\*)?\\s*[：:]?\\s*`, 'g');
  const matches = Array.from(text.matchAll(pattern));
  if (!matches.length) return [];
  return matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index || text.length : text.length;
    return { title: match[1], content: text.slice(start, end).trim() };
  }).filter((section) => section.content);
}

function normalizeWrongCauseText(value?: string, strictType = false): string {
  const text = value?.trim() || '';
  if (!text) return '';
  if (/^(与?标准答案不一致|答案错误|选择错误|不符合题意|做错了)[。.!！]*$/.test(text)) return '';
  if (strictType && /标准答案|不一致|答案错误|选择错误|不符合题意/.test(text)) return '';
  return text;
}
</script>

<style scoped>
.question-answer-region {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-x: hidden;
}
.question-prompt-region {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.question-prompt-region > strong {
  color: var(--text-color);
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
.question-prompt-region :deep(.markdown-content) {
  color: #303642;
  font-size: var(--type-size-body);
  line-height: 1.62;
}
.answer-region-sheet .question-prompt-region :deep(.markdown-content) {
  max-height: 92px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.answer-options-region {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.option-item {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 46px;
  border: none;
  border-radius: 9px;
  padding: 10px 12px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: #303642;
  background: rgba(255, 255, 255, .16);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform .15s ease, background .15s ease, box-shadow .15s ease;
}
.option-item:not(:disabled):active { transform: scale(.985); }
.option-item.selected { background: rgba(var(--color-brand-rgb), .055); box-shadow: inset 2px 0 0 var(--primary-color); }
.option-item.correct { color: #1e8e3e; background: rgba(52, 168, 83, .07); box-shadow: inset 2px 0 0 var(--green-color); }
.option-item.incorrect { color: #d93025; background: rgba(255, 59, 48, .065); box-shadow: inset 2px 0 0 var(--red-color); }
.option-letter {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-secondary-color);
  background: rgba(var(--color-ink-rgb), .035);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.option-item.selected .option-letter { color: #fff; background: var(--primary-color); }
.option-item.correct .option-letter { color: #fff; background: var(--green-color); }
.option-item.incorrect .option-letter { color: #fff; background: var(--red-color); }
.option-text {
  min-width: 0;
  flex: 1;
  padding-top: 1px;
  overflow: visible;
  color: inherit;
  font-size: var(--type-size-body-large);
  font-weight: var(--type-weight-regular);
  line-height: 1.58;
}
.option-text :deep(p) { margin: 0; }
.option-text :deep(p + p) { margin-top: 6px; }
.option-text :deep(svg),
.option-text :deep(img) {
  display: block;
  width: min(100%, 132px);
  max-height: 74px;
  margin: 0;
  padding: 5px;
  box-sizing: border-box;
  object-fit: contain;
  background: transparent;
}
.graphic-answer-region .option-text :deep(svg),
.graphic-answer-region .option-text :deep(img) {
  width: auto;
  max-width: min(100%, 136px);
  height: auto;
  max-height: 84px;
  padding: 4px;
  object-fit: contain;
  overflow: hidden;
}
.graphic-answer-region {
  overflow-x: hidden;
  touch-action: pan-y;
}
.graphic-answer-region .answer-options-region {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.graphic-answer-region .option-item {
  min-height: 92px;
  padding: 8px 10px;
}
.graphic-answer-region .option-text {
  width: 100%;
  min-height: 84px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  overflow: hidden;
}
.option-text :deep(p:has(svg)),
.option-text :deep(p:has(img)) {
  min-height: 78px;
  display: flex;
  align-items: center;
}
.grading-region {
  padding: 11px 12px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(255, 59, 48, .13), rgba(255, 255, 255, .76));
  box-shadow: inset 3px 0 0 var(--red-color), 0 8px 20px rgba(217, 48, 37, .08);
}
.grading-copy { display: flex; flex-direction: column; gap: 4px; }
.grading-region strong { color: #c5221f; font-size: var(--type-size-secondary); font-weight: var(--type-weight-semibold); }
.grading-region span,
.grading-region em { color: #7f1d1d; font-size: var(--type-size-secondary); line-height: 1.55; }
.grading-region > em {
  display: block;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(217, 48, 37, .12);
  font-style: normal;
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
.wrong-cause-loading em { color: #8a3b24; font-size: var(--type-size-caption); font-style: normal; font-weight: var(--type-weight-semibold); }
.cat-face {
  position: relative;
  width: 26px;
  height: 22px;
  border-radius: 12px 12px 10px 10px;
  flex-shrink: 0;
  background: #fff4e8;
  box-shadow: inset 0 0 0 1px rgba(138, 59, 36, .12);
  animation: cat-bob 1.05s ease-in-out infinite;
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
.review-actions { display: flex; align-items: center; gap: 8px; }
.answer-toggle {
  min-width: 0;
  min-height: 34px;
  border: none;
  padding: 0 2px;
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  color: var(--primary-color);
  background: transparent;
  font: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
  text-align: left;
}
.answer-toggle.correct { color: var(--green-color); }
.answer-toggle.wrong { color: var(--red-color); }
.answer-toggle em {
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.answer-toggle i {
  width: 8px;
  height: 8px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(45deg);
  transition: transform .16s ease;
}
.answer-toggle.open i { transform: rotate(225deg); }
.ask-ai-btn {
  min-height: 28px;
  border: none;
  border-radius: 9px;
  padding: 0 10px;
  flex-shrink: 0;
  color: var(--text-secondary-color);
  background: rgba(var(--color-ink-rgb), .06);
  font: inherit;
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.explanation-content {
  margin-top: 4px;
  padding: 12px 13px;
  border-radius: 12px;
  background: rgba(255, 255, 255, .34);
  box-shadow: inset 2px 0 0 rgba(var(--color-brand-rgb), .16), 0 8px 18px rgba(var(--color-ink-rgb), .035);
  font-size: var(--type-size-body);
  line-height: 1.65;
}
.explanation-section + .explanation-section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(var(--color-ink-rgb), .045);
}
.explanation-section > strong { display: block; margin-bottom: 5px; color: #3d4654; font-size: var(--type-size-secondary); font-weight: var(--type-weight-semibold); }
.explanation-section :deep(p),
.explanation-section :deep(ol),
.explanation-section :deep(ul) { margin-top: 0; margin-bottom: 0; }
@keyframes cat-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes cat-blink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.18); } }
@media (max-width: 380px) {
  .option-text :deep(svg),
  .option-text :deep(img) { width: min(100%, 118px); max-height: 66px; }
}
</style>
