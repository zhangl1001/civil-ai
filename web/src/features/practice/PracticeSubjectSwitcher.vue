<template>
  <nav class="subject-switcher" aria-label="训练科目">
    <button
      v-for="item in items"
      :key="item.value"
      type="button"
      :class="{ active: modelValue === item.value }"
      :aria-pressed="modelValue === item.value"
      @click="$emit('update:modelValue', item.value)"
    >
      {{ item.label }}
    </button>
  </nav>
</template>

<script setup lang="ts">
import { PracticeSubject, type PracticeSubject as PracticeSubjectCode } from './PracticeSubject';

defineProps<{ modelValue: PracticeSubjectCode }>();
defineEmits<{ 'update:modelValue': [value: PracticeSubjectCode] }>();

const items = [
  { value: PracticeSubject.Aptitude, label: '行' },
  { value: PracticeSubject.Essay, label: '申' }
] as const;
</script>

<style scoped>
.subject-switcher {
  position: fixed;
  left: max(8px, env(safe-area-inset-left));
  bottom: calc(var(--app-bottom-nav-reserved) + 10px);
  z-index: 7;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 5px;
  border-radius: 999px;
  background: rgba(var(--color-surface-rgb), .68);
  box-shadow: 0 8px 22px rgba(var(--color-ink-rgb), .1);
  backdrop-filter: blur(14px) saturate(1.08);
  -webkit-backdrop-filter: blur(14px) saturate(1.08);
}

.subject-switcher button {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  color: var(--text-secondary-color);
  background: transparent;
  font: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.subject-switcher button.active {
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .11);
}
</style>
