<template>
  <article :class="['lecture-content', { 'app-card': surface }]">
    <ContentDocumentRenderer
      v-if="document"
      :document="document"
      presentation="lecture"
    />
    <MarkdownContent v-else-if="markdown" :content="markdown" />
  </article>
</template>

<script setup lang="ts">
import type { ContentDocument } from '@/modules/content/public';
import MarkdownContent from '@/components/MarkdownContent.vue';
import ContentDocumentRenderer from '@/components/content/ContentDocumentRenderer.vue';

withDefaults(defineProps<{
  readonly document?: ContentDocument;
  readonly markdown?: string;
  readonly surface?: boolean;
}>(), {
  document: undefined,
  markdown: '',
  surface: false
});
</script>

<style scoped>
.lecture-content {
  min-width: 0;
  color: var(--text-color);
}

.lecture-content.app-card {
  padding: 16px;
  border-color: transparent;
  background: rgba(255, 255, 255, .72);
}
</style>
