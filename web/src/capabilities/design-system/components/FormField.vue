<template>
  <label class="form-field">
    <span class="form-field-label">{{ label }}</span>
    <slot></slot>
    <small v-if="error" class="form-field-error">{{ error }}</small>
    <small v-else-if="hint" class="form-field-hint">{{ hint }}</small>
  </label>
</template>

<script setup lang="ts">
defineProps<{
  label: string;
  hint?: string;
  error?: string;
}>();
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
