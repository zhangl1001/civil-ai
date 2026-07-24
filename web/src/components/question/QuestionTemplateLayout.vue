<template>
  <article :class="['question-template-layout', `template-${template}`]" :data-question-template="template">
    <section v-if="showMeta && $slots.meta" class="template-region region-meta" data-question-region="meta">
      <slot name="meta" />
    </section>
    <section v-if="showMaterial && $slots.material" class="template-region region-material" data-question-region="material">
      <slot name="material" />
    </section>
    <section v-if="showQuestion && $slots.question" class="template-region region-question" data-question-region="question">
      <slot name="question" />
    </section>
    <section v-if="showAnswer && $slots.answer" class="template-region region-answer" data-question-region="answer">
      <slot name="answer" />
    </section>
    <section v-if="showGrading && $slots.grading" class="template-region region-grading" data-question-region="grading">
      <slot name="grading" />
    </section>
    <section v-if="showExplanation && $slots.explanation" class="template-region region-explanation" data-question-region="explanation">
      <slot name="explanation" />
    </section>
    <slot name="overlay" />
  </article>
</template>

<script setup lang="ts">
import type { QuestionRenderTemplate } from '@/domain/question';

withDefaults(defineProps<{
  template: QuestionRenderTemplate | 'answer_sheet';
  showMeta?: boolean;
  showMaterial?: boolean;
  showQuestion?: boolean;
  showAnswer?: boolean;
  showGrading?: boolean;
  showExplanation?: boolean;
}>(), {
  showMeta: true,
  showMaterial: true,
  showQuestion: true,
  showAnswer: true,
  showGrading: true,
  showExplanation: true
});
</script>

<style scoped>
.question-template-layout {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.template-region {
  min-width: 0;
}
.template-answer_sheet {
  min-height: 0;
  gap: 10px;
}
.template-answer_sheet .region-question,
.template-answer_sheet .region-answer,
.template-answer_sheet .region-grading,
.template-answer_sheet .region-explanation {
  flex-shrink: 0;
}
</style>
