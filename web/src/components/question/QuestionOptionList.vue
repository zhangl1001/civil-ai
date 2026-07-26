<template>
  <div :class="['question-option-list', { compact }]">
    <button
      v-for="option in options"
      :key="option.id"
      :class="optionClass(option.id)"
      type="button"
      :disabled="disabled || readonlyMode"
      @click="select(option.id)"
    >
      <b>{{ option.id }}</b>
      <ContentDocumentRenderer class="option-content" :document="option.content" text-variant="compact" />
    </button>
  </div>
</template>

<script setup lang="ts">
import ContentDocumentRenderer from '@/components/content/ContentDocumentRenderer.vue';
import type { SingleChoiceOption } from '@/modules/content/public';

const props = withDefaults(defineProps<{
  readonly options: readonly SingleChoiceOption[];
  readonly selectedOptionId?: string;
  readonly correctOptionId?: string;
  readonly revealResult?: boolean;
  readonly disabled?: boolean;
  readonly readonlyMode?: boolean;
  readonly compact?: boolean;
}>(), {
  selectedOptionId: '',
  correctOptionId: '',
  revealResult: false,
  disabled: false,
  readonlyMode: false,
  compact: false
});

const emit = defineEmits<{
  select: [optionId: string];
}>();

function optionClass(optionId: string) {
  const selected = props.selectedOptionId === optionId;
  return {
    selected,
    correct: props.revealResult && props.correctOptionId === optionId,
    wrong: props.revealResult && selected && props.correctOptionId !== optionId
  };
}

function select(optionId: string) {
  if (!props.disabled && !props.readonlyMode) emit('select', optionId);
}
</script>

<style scoped>
.question-option-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.question-option-list > button {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px;
  border: 0;
  border-radius: 8px;
  background: rgba(var(--color-ink-rgb), .035);
  color: inherit;
  text-align: left;
}

.question-option-list.compact > button {
  padding: 9px;
}

.question-option-list > button:disabled {
  opacity: 1;
}

.question-option-list > button.selected {
  background: rgba(var(--color-brand-rgb), .11);
}

.question-option-list > button.correct {
  background: rgba(52, 199, 89, .14);
}

.question-option-list > button.wrong {
  background: rgba(255, 59, 48, .12);
}

.question-option-list b {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  margin-top: 1px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(var(--color-ink-rgb), .08);
  font-size: var(--type-size-caption);
  font-weight: 600;
  line-height: 1;
  text-align: center;
}

.option-content {
  min-width: 0;
  flex: 1;
}

.option-content :deep(.markdown-content-compact > :first-child) {
  margin-top: 0;
}

.option-content :deep(.content-svg),
.option-content :deep(.content-image) {
  width: 100%;
  max-height: 150px;
}

.option-content :deep(svg),
.option-content :deep(img) {
  width: auto;
  max-width: 100%;
  height: auto;
  max-height: 150px;
  object-fit: contain;
}
</style>
