<template>
  <FloatingBubbleSwitcher
    class="practice-subject-switcher"
    :model-value="activeIndex"
    :options="items"
    aria-label="训练科目切换"
    draggable
    @update:model-value="updateSubjectByIndex"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  FloatingBubbleSwitcher,
  type FloatingBubbleSwitcherOption
} from '../../capabilities/design-system/public';
import { PracticeSubject, type PracticeSubject as PracticeSubjectCode } from './PracticeSubject';

const props = defineProps<{ modelValue: PracticeSubjectCode }>();
const emit = defineEmits<{ 'update:modelValue': [value: PracticeSubjectCode] }>();

const items = [
  { index: 0, label: '行测', text: '行' },
  { index: 1, label: '申论', text: '申' }
] satisfies readonly FloatingBubbleSwitcherOption[];

const subjects = [PracticeSubject.Aptitude, PracticeSubject.Essay] as const;
const activeIndex = computed(() => {
  const position = Math.max(0, subjects.indexOf(props.modelValue));
  return items[position]?.index ?? items[0].index;
});

function updateSubjectByIndex(index: number): void {
  const position = items.findIndex((item) => item.index === index);
  const subject = subjects[position];
  if (subject) emit('update:modelValue', subject);
}
</script>

<style scoped>
.practice-subject-switcher {
  position: fixed;
  left: max(8px, env(safe-area-inset-left));
  bottom: calc(var(--app-bottom-nav-reserved) + 10px);
  z-index: 7;
}
</style>
