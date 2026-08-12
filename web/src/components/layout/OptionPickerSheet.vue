<template>
  <BottomSheet
    :model-value="modelValue"
    :title="title"
    :subtitle="subtitle"
    variant="form"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="option-picker-grid" role="listbox" :aria-label="title">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        :class="{ active: option.value === value }"
        role="option"
        :aria-selected="option.value === value"
        @click="select(option.value)"
      >
        <span>{{ option.label }}</span>
        <CheckIcon v-if="option.value === value" />
      </button>
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { CheckIcon } from 'lucide-vue-next';
import BottomSheet from './BottomSheet.vue';

defineProps<{
  modelValue: boolean;
  value: string;
  title: string;
  subtitle?: string;
  options: readonly { readonly value: string; readonly label: string }[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  select: [value: string];
}>();

function select(value: string) {
  emit('select', value);
  emit('update:modelValue', false);
}
</script>

<style scoped>
.option-picker-grid {
  max-height: min(44dvh, 390px);
  overflow-y: auto;
  overscroll-behavior: contain;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 2px 0 4px;
  -webkit-overflow-scrolling: touch;
}

.option-picker-grid button {
  min-width: 0;
  min-height: 42px;
  border: none;
  border-radius: var(--radius-control);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 7px;
  background: var(--surface-control);
  color: var(--text-secondary-color);
  font: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-medium);
}

.option-picker-grid button span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-picker-grid button svg {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

.option-picker-grid button.active {
  background: rgba(var(--color-brand-rgb), .13);
  color: var(--primary-color);
  font-weight: var(--type-weight-semibold);
}

@media (max-width: 360px) {
  .option-picker-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
