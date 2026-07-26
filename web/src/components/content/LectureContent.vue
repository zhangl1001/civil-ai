<template>
  <article :class="['lecture-content', { 'app-card': surface }]">
    <ContentDocumentRenderer
      v-if="document"
      :document="document"
      presentation="lecture"
    />
    <MarkdownContent
      v-else-if="markdown"
      class="lecture-markdown"
      :content="markdown"
    />
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

.lecture-markdown {
  color: var(--text-secondary-color);
}

.lecture-markdown :deep(h1),
.lecture-markdown :deep(h2) {
  margin-top: 18px;
  color: var(--text-color);
  font-size: var(--type-size-section-title);
}

.lecture-markdown :deep(h1:first-child),
.lecture-markdown :deep(h2:first-child) {
  margin-top: 0;
}

.lecture-markdown :deep(h3),
.lecture-markdown :deep(h4) {
  margin-top: 14px;
  color: var(--text-color);
  font-size: var(--type-size-body);
}

.lecture-markdown :deep(strong) {
  color: var(--text-color);
}
</style>
