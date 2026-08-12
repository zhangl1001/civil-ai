<template>
  <span class="subject-mark" :aria-label="`当前科目：${practiceSubjectLabel(subject)}`">
    {{ practiceSubjectShortLabel(subject) }}
  </span>
</template>

<script setup lang="ts">
import {
  practiceSubjectLabel,
  practiceSubjectShortLabel,
  type PracticeSubject
} from './PracticeSubject';

defineProps<{ subject: PracticeSubject }>();
</script>

<style scoped>
.subject-mark {
  position: absolute;
  top: 13px;
  right: 13px;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(255, 255, 255, .34);
  border-radius: var(--radius-pill);
  display: grid;
  place-items: center;
  color: var(--primary-color);
  background: rgba(var(--color-surface-rgb), .42);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .42);
  backdrop-filter: blur(10px) saturate(1.06);
  -webkit-backdrop-filter: blur(10px) saturate(1.06);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
  line-height: 1;
}
</style>
