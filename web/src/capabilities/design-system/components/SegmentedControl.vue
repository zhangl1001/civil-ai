<template>
  <div class="segmented-control" role="group" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :class="{ active: modelValue === option.value }"
      @click="$emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: string;
  label: string;
  options: readonly { readonly value: string; readonly label: string }[];
}>();

defineEmits<{
  'update:modelValue': [value: string];
}>();
</script>

<style scoped>
.segmented-control {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 3px;
  min-height: 42px;
  padding: 3px;
  border-radius: var(--radius-control);
  background: var(--surface-muted);
}

.segmented-control button {
  min-width: 0;
  border: none;
  border-radius: 8px;
  padding: 6px 8px;
  background: transparent;
  color: var(--text-secondary-color);
  font: inherit;
  font-size: var(--type-size-secondary);
  white-space: normal;
}

.segmented-control button.active {
  background: var(--surface-card-strong);
  color: var(--primary-color);
  box-shadow: var(--shadow-card);
  font-weight: var(--type-weight-medium);
}
</style>
