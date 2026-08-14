<template>
  <section class="question-explanation">
    <header>
      <span>正确答案</span>
      <b>{{ correctAnswer }}</b>
    </header>
    <slot name="after-answer" />
    <article
      v-for="block in document.blocks"
      :key="block.id"
      :class="['explanation-section', block.type === 'callout' ? `tone-${block.kind}` : 'tone-default']"
    >
      <div class="section-label">
        <component :is="iconFor(block)" />
        <strong>{{ titleFor(block) }}</strong>
      </div>
      <ContentDocumentRenderer
        :document="{ schemaVersion: document.schemaVersion, blocks: block.type === 'callout' ? block.blocks : [block] }"
        text-variant="compact"
      />
    </article>
  </section>
</template>

<script setup lang="ts">
import { CheckCircle2Icon, LightbulbIcon, ListChecksIcon, RouteIcon, TriangleAlertIcon } from 'lucide-vue-next';
import ContentDocumentRenderer from '@/components/content/ContentDocumentRenderer.vue';
import type { ContentBlock, ContentDocument } from '@/modules/content/public';

defineProps<{
  readonly document: ContentDocument;
  /** Answer key as displayed, e.g. `A` or `ABD`. */
  readonly correctAnswer: string;
}>();

function titleFor(block: ContentBlock): string {
  if (block.type === 'callout' && block.title) return block.title;
  if (block.type === 'callout' && block.kind === 'method') return '解题思路';
  if (block.type === 'callout' && block.kind === 'trap') return '易错提醒';
  if (block.type === 'callout' && block.kind === 'conclusion') return '结论与考点';
  if (block.type === 'callout' && block.kind === 'hint') return '选项辨析';
  return '解析说明';
}

function iconFor(block: ContentBlock) {
  if (block.type !== 'callout') return LightbulbIcon;
  if (block.kind === 'method') return RouteIcon;
  if (block.kind === 'trap' || block.kind === 'wrong_cause') return TriangleAlertIcon;
  if (block.kind === 'conclusion') return CheckCircle2Icon;
  return ListChecksIcon;
}
</script>

<style scoped>
.question-explanation { display:flex; flex-direction:column; gap:10px; }
.question-explanation>header { min-height:42px; display:flex; align-items:center; justify-content:space-between; padding:0 12px; border-radius:8px; color:var(--green-color); background:rgba(52,199,89,.075); }
.question-explanation>header span { font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }
.question-explanation>header b { width:26px; height:26px; display:grid; place-items:center; border-radius:50%; background:rgba(52,199,89,.14); font-size:var(--type-size-secondary); }
.explanation-section { padding:11px 12px; border-radius:8px; background:rgba(var(--color-ink-rgb),.03); }
.section-label { display:flex; align-items:center; gap:7px; margin-bottom:8px; }
.section-label svg { width:16px; height:16px; color:var(--primary-color); }
.section-label strong { font-size:var(--type-size-secondary); }
.tone-conclusion { background:rgba(52,199,89,.055); }
.tone-conclusion .section-label svg { color:var(--green-color); }
.tone-trap,.tone-wrong_cause { background:rgba(255,149,0,.065); }
.tone-trap .section-label svg,.tone-wrong_cause .section-label svg { color:var(--orange-color); }
.tone-hint { background:rgba(var(--color-brand-rgb),.045); }
</style>
