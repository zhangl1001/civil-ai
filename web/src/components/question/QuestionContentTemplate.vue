<template>
  <article :class="['question-content-template', `question-template-${definition.code}`, `question-layout-${layout}`]">
    <template v-for="region in orderedRegions" :key="region">
      <section v-if="region === QuestionRegionCode.Material && question.material" class="question-region question-region-material">
        <ContentDocumentRenderer :document="question.material" :text-variant="materialTextVariant" />
      </section>

      <section v-else-if="region === QuestionRegionCode.Prompt" class="question-region question-region-prompt">
        <ContentDocumentRenderer :document="question.prompt" />
      </section>

      <section v-else-if="region === QuestionRegionCode.Options" class="question-region question-region-options">
        <p v-if="multiSelect" class="question-multi-answer-hint">{{ multiAnswerHint }}</p>
        <QuestionOptionList
          :options="question.options"
          :presentation="definition.code"
          :selected-option-ids="selectedOptionIds"
          :correct-option-ids="correctOptionIds"
          :multi-select="multiSelect"
          :reveal-result="revealResult"
          :readonly-mode="readonlyMode"
          :disabled="disabled"
          :compact="compact"
          @select="select"
        />
      </section>

      <section v-else-if="region === QuestionRegionCode.Explanation && showExplanation" class="question-region question-region-explanation">
        <QuestionExplanationView :document="question.explanation" :correct-answer="correctAnswer">
          <template v-if="layout !== QuestionRegionLayoutCode.Flashcard && $slots.diagnosis" #after-answer>
            <slot name="diagnosis" />
          </template>
        </QuestionExplanationView>
      </section>

      <section v-else-if="region === QuestionRegionCode.Diagnosis && $slots.diagnosis" class="question-region question-region-diagnosis">
        <slot name="diagnosis" />
      </section>
    </template>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ContentDocumentRenderer from '@/components/content/ContentDocumentRenderer.vue';
import QuestionExplanationView from '@/components/question/QuestionExplanationView.vue';
import QuestionOptionList from '@/components/question/QuestionOptionList.vue';
import {
  QuestionRegionCode,
  QuestionRegionLayoutCode,
  QuestionPresentationCode,
  QuestionTemplateCode,
  correctAnswerLabel,
  correctOptionIdsOf,
  isMultiAnswerChoice,
  questionPresentationDefinition,
  questionRegionOrder,
  resolveQuestionPresentation,
  type QuestionContent,
  type QuestionPresentationCodeValue,
  type QuestionRegionLayoutCodeValue
} from '@/modules/content/public';

const props = withDefaults(defineProps<{
  readonly question: QuestionContent;
  readonly presentation?: QuestionPresentationCodeValue;
  readonly layout?: QuestionRegionLayoutCodeValue;
  readonly selectedOptionIds?: readonly string[];
  readonly revealResult?: boolean;
  readonly readonlyMode?: boolean;
  readonly disabled?: boolean;
  readonly compact?: boolean;
  readonly showExplanation?: boolean;
}>(), {
  presentation: undefined,
  layout: QuestionRegionLayoutCode.Practice,
  selectedOptionIds: () => [],
  revealResult: false,
  readonlyMode: false,
  disabled: false,
  compact: false,
  showExplanation: false
});

const definition = computed(() => questionPresentationDefinition(
  props.presentation || resolveQuestionPresentation(props.question)
));
const multiSelect = computed(() => isMultiAnswerChoice(props.question));
const correctOptionIds = computed(() => correctOptionIdsOf(props.question));
const correctAnswer = computed(() => correctAnswerLabel(props.question));
const multiAnswerHint = computed(() => props.question.templateCode === QuestionTemplateCode.MultipleChoice
  ? '多选题 · 至少两个正确选项，少选得部分分，错选不得分'
  : '不定项选择 · 正确选项数量未知，少选得部分分，错选不得分');
const materialTextVariant = computed(() => (
  definition.value.code === QuestionPresentationCode.DataMaterialChoice ? 'data' : 'compact'
));
const orderedRegions = computed(() => questionRegionOrder(props.layout)
  .filter((region) => definition.value.regions.includes(region)));

const emit = defineEmits<{
  select: [optionId: string];
}>();

function select(optionId: string): void {
  emit('select', optionId);
}
</script>

<style scoped>
.question-content-template {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 14px;
}

.question-region {
  min-width: 0;
}

.question-region-material {
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(var(--color-ink-rgb), .06);
}

.question-template-shared_material_choice .question-region-material,
.question-template-data_material_choice .question-region-material {
  padding-bottom: 12px;
}

.question-template-graphic_choice .question-region-options {
  padding-top: 2px;
}

.question-multi-answer-hint {
  margin: 0 0 8px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
}
</style>
