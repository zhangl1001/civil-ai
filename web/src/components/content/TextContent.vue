<template>
  <MarkdownContent :class="['text-content', `text-content-${variant}`]" :content="content" :variant="markdownVariant" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MarkdownContent from '@/components/MarkdownContent.vue';

const props = withDefaults(defineProps<{
  readonly content: string;
  readonly variant?: 'default' | 'compact' | 'data';
}>(), {
  variant: 'default'
});

const markdownVariant = computed(() => props.variant === 'default' ? 'default' : props.variant);
</script>

<style scoped>
.text-content {
  color: inherit;
  font-size: inherit;
  line-height: 1.72;
  word-break: break-word;
}
.text-content-compact {
  font-size: var(--type-size-secondary);
  line-height: 1.58;
}
.text-content-data {
  line-height: 1.64;
  font-variant-numeric: tabular-nums;
}
</style>
