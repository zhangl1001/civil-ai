<template>
  <div class="answer-card-grid">
    <button
      v-for="(item, itemIndex) in questions"
      :key="item.id"
      type="button"
      :class="getItemClass(item, itemIndex)"
      @click="$emit('select', itemIndex)"
    >
      {{ itemIndex + 1 }}
    </button>
  </div>
</template>

<script setup lang="ts">
export interface AnswerCardQuestionItem {
  id: string;
  correctOptionIds?: readonly string[];
}

const props = defineProps<{
  questions: AnswerCardQuestionItem[];
  currentIndex: number;
  answers: Record<string, readonly string[]>;
  submitted: boolean;
}>();

defineEmits<{
  select: [index: number];
}>();

function getItemClass(item: AnswerCardQuestionItem, itemIndex: number) {
  const selected = props.answers[item.id] ?? [];
  const correct = item.correctOptionIds;
  // Only a complete, exact match counts as correct on the answer card; partial
  // credit still reads as wrong here so the learner revisits the question.
  const isCorrect = correct
    ? selected.length === correct.length && selected.every((optionId) => correct.includes(optionId))
    : false;
  return {
    active: itemIndex === props.currentIndex,
    answered: selected.length > 0,
    wrong: props.submitted && selected.length > 0 && !isCorrect
  };
}
</script>

<style scoped>
.answer-card-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

.answer-card-grid button {
  height: 36px;
  border: 0;
  border-radius: 9px;
  color: var(--text-secondary-color);
  background: rgba(var(--color-ink-rgb), 0.06);
  font: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}

.answer-card-grid button.answered {
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), 0.12);
}

.answer-card-grid button.active {
  outline: 2px solid var(--primary-color);
  outline-offset: 1px;
}

.answer-card-grid button.wrong {
  color: var(--red-color);
  background: rgba(255, 59, 48, 0.12);
}
</style>
