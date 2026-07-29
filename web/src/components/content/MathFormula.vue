<template>
  <MarkdownContent
    :class="['math-formula', `math-formula-${display}`]"
    :content="markdown"
    variant="data"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MarkdownContent from '@/components/MarkdownContent.vue';

const props = defineProps<{
  readonly source: string;
  readonly display: 'inline' | 'block';
}>();

const markdown = computed(() => {
  const source = stripOuterDelimiter(props.source);
  return props.display === 'block' ? `$$\n${source}\n$$` : `$${source}$`;
});

function stripOuterDelimiter(value: string): string {
  const source = value.trim();
  const match = source.match(/^(\${1,2})\s*([\s\S]*?)\s*\1$/);
  return match?.[2]?.trim() || source;
}
</script>

<style scoped>
.math-formula {
  min-width: 0;
}

.math-formula-block {
  padding: 2px 0;
}

.math-formula-inline {
  display: inline-block;
  width: auto;
  max-width: 100%;
}
</style>
