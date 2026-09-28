<template>
  <component
    :is="group ? 'div' : 'label'"
    class="form-field"
    :role="group ? 'group' : undefined"
    :aria-labelledby="group ? labelId : undefined"
  >
    <span :id="group ? labelId : undefined" class="form-field-label">{{ label }}</span>
    <slot></slot>
    <small v-if="error" class="form-field-error">{{ error }}</small>
    <small v-else-if="hint" class="form-field-hint">{{ hint }}</small>
  </component>
</template>

<script setup lang="ts">
import { useId } from 'vue';

defineProps<{
  label: string;
  hint?: string;
  error?: string;
  /**
   * Set when the field holds buttons (a segmented control, a chip picker). A
   * <label> activates its first labelable descendant on any tap inside it, so
   * tapping the caption would silently select the first option.
   */
  group?: boolean;
}>();

const labelId = useId();
</script>

<style scoped>
.form-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

.form-field-label {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-medium);
}

.form-field :deep(input),
.form-field :deep(textarea) {
  width: 100%;
  min-height: 44px;
  border: none;
  border-radius: var(--radius-control);
  outline: none;
  padding: 0 12px;
  background: var(--surface-control);
  color: var(--text-color);
  font: inherit;
  box-shadow: inset 0 0 0 1px transparent;
}

.form-field :deep(textarea) {
  min-height: 76px;
  padding-block: 10px;
  resize: vertical;
  line-height: 1.55;
}

.form-field :deep(input:focus),
.form-field :deep(textarea:focus) {
  box-shadow: inset 0 0 0 1px var(--border-focus);
}

.form-field-hint,
.form-field-error {
  font-size: var(--type-size-micro);
  line-height: 1.4;
}

.form-field-hint {
  color: var(--color-text-tertiary);
}

.form-field-error {
  color: var(--color-danger);
}
</style>
