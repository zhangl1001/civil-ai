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
  correctOptionId?: string;
}

const props = defineProps<{
  questions: AnswerCardQuestionItem[];
  currentIndex: number;
  answers: Record<string, string>;
  submitted: boolean;
}>();

defineEmits<{
  select: [index: number];
}>();

function getItemClass(item: AnswerCardQuestionItem, itemIndex: number) {
  const answered = !!props.answers[item.id];
  const isCorrect = item.correctOptionId ? props.answers[item.id] === item.correctOptionId : false;
  return {
    active: itemIndex === props.currentIndex,
    answered,
    wrong: props.submitted && answered && !isCorrect
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
