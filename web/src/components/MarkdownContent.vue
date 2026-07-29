<template>
  <div :class="['markdown-content', `markdown-content-${variant}`]" v-html="html"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  HtmlPolicy,
  MarkdownEngine,
  escapeHtml,
  normalizeMarkdownSource
} from '@/capabilities/content-rendering/public';

const props = withDefaults(defineProps<{
  content: string;
  stoppedLabel?: string;
  variant?: 'default' | 'compact' | 'chat' | 'data';
}>(), {
  stoppedLabel: '已停止',
  variant: 'default'
});

const htmlPolicy = new HtmlPolicy();
const markdownEngine = new MarkdownEngine(htmlPolicy);

const html = computed(() => {
  const source = normalizeMarkdownSource(props.content);
  const stopped = source.includes('[[ZH_AI_STOPPED]]')
    || source.includes('（已中断）')
    || source.includes('（已停止）');
  const clean = source
    .replace(/\n?\s*\[\[ZH_AI_STOPPED\]\]\s*$/g, '')
    .replace(/\n?\s*（已中断）\s*$/g, '')
    .replace(/\n?\s*（已停止）\s*$/g, '')
    .trim();
  if (!clean) {
    return stopped
      ? htmlPolicy.sanitize(`<p class="markdown-stopped-empty">${escapeHtml(props.stoppedLabel)}</p>`)
      : '';
  }
  const rendered = markdownEngine.render(clean).html;
  const withStatus = stopped && clean
    ? `${rendered}<p class="markdown-stopped-note">（${props.stoppedLabel}）</p>`
    : rendered;
  return htmlPolicy.sanitize(withStatus);
});

</script>

<style scoped>
.markdown-content {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow-x: hidden;
  color: inherit;
  font-size: inherit;
  line-height: 1.72;
  overflow-wrap: anywhere;
}
.markdown-content :deep(p) {
  margin: 0 0 8px;
}
.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}
.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  margin: 12px 0 7px;
  color: var(--text-color);
  font-size: var(--type-size-body);
  line-height: 1.45;
}
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  margin: 10px 0 6px;
  color: var(--text-color);
  font-size: var(--type-size-secondary);
  line-height: 1.45;
}
.markdown-content :deep(hr) {
  height: 1px;
  margin: 14px 0;
  border: 0;
  background: rgba(var(--color-ink-rgb), .1);
}
.markdown-content :deep(mark) {
  border-radius: 4px;
  padding: 0 3px;
  color: inherit;
  background: rgba(255, 214, 10, .22);
}
.markdown-content :deep(kbd) {
  border: 1px solid rgba(var(--color-ink-rgb), .12);
  border-radius: 5px;
  padding: 1px 5px;
  background: rgba(255, 255, 255, .7);
  box-shadow: 0 1px 1px rgba(var(--color-ink-rgb), .08);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: .86em;
}
.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 8px 0;
  padding-left: 18px;
}
.markdown-content :deep(li) {
  margin: 4px 0;
}
.markdown-content :deep(li.task-list-item) {
  list-style: none;
}
.markdown-content :deep(input[type='checkbox']) {
  width: 14px;
  height: 14px;
  margin: 0 6px 0 -18px;
  accent-color: var(--primary-color);
  vertical-align: -2px;
}
.markdown-content :deep(blockquote) {
  margin: 10px 0;
  border-left: 3px solid rgba(var(--color-ink-rgb), .16);
  padding: 2px 0 2px 10px;
  color: var(--text-secondary-color);
}
.markdown-content :deep(code) {
  border-radius: 5px;
  padding: 1px 5px;
  background: rgba(var(--color-ink-rgb), .07);
  font-size: .92em;
  overflow-wrap: anywhere;
}
.markdown-content :deep(pre) {
  overflow-x: auto;
  margin: 10px 0;
  border-radius: 10px;
  padding: 10px;
  background: rgba(var(--color-ink-rgb), .08);
}
.markdown-content :deep(pre code) {
  padding: 0;
  background: transparent;
}
.markdown-content :deep(details) {
  margin: 10px 0;
  border-radius: 9px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, .34);
  box-shadow: inset 0 0 0 1px rgba(var(--color-ink-rgb), .06);
}
.markdown-content :deep(summary) {
  cursor: pointer;
  color: var(--text-color);
  font-weight: var(--type-weight-semibold);
}
.markdown-content :deep(figure) {
  margin: 10px 0;
}
.markdown-content :deep(figcaption) {
  margin-top: 5px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  text-align: center;
}
.markdown-content :deep(dl) { margin: 10px 0; }
.markdown-content :deep(dt) { color: var(--text-color); font-weight: var(--type-weight-semibold); }
.markdown-content :deep(dd) { margin: 3px 0 8px 14px; color: var(--text-secondary-color); }
.markdown-content :deep(a) {
  color: #4b6bb6;
  text-decoration: none;
}
.markdown-content :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 10px 0;
  border-radius: 10px;
  object-fit: contain;
}
.markdown-content :deep(svg) {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  margin: 8px 0;
  overflow: hidden;
  border-radius: 10px;
  background: rgba(255, 255, 255, .68);
}
.markdown-content :deep(.katex) {
  max-width: 100%;
  color: var(--text-color);
  font-size: 1em;
}
.markdown-content :deep(.katex-display) {
  width: 100%;
  max-width: 100%;
  margin: 10px 0;
  padding: 2px 0;
  overflow-x: auto;
  overflow-y: hidden;
  text-align: center;
  -webkit-overflow-scrolling: touch;
}
.markdown-content :deep(.katex-error) {
  color: var(--red-color) !important;
  font-family: inherit;
  white-space: normal;
  overflow-wrap: anywhere;
}
.markdown-content :deep(table) {
  width: 100%;
  min-width: 420px;
  max-width: 100%;
  border-collapse: collapse;
  margin: 0;
  font-size: var(--type-size-caption);
  font-variant-numeric: tabular-nums;
}
.markdown-content :deep(.markdown-table-scroll) {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin: 10px 0;
  overflow-x: auto;
  border-radius: 10px;
  background: rgba(255, 255, 255, .42);
  box-shadow: inset 0 0 0 1px rgba(var(--color-ink-rgb), .055);
  -webkit-overflow-scrolling: touch;
}
.markdown-content :deep(th),
.markdown-content :deep(td) {
  border-right: 1px solid rgba(var(--color-ink-rgb), .055);
  border-bottom: 1px solid rgba(var(--color-ink-rgb), .065);
  padding: 8px 9px;
  text-align: left;
  white-space: nowrap;
  overflow-wrap: anywhere;
}
.markdown-content :deep(th) {
  color: #374151;
  background: rgba(221, 229, 241, .72);
  font-weight: var(--type-weight-semibold);
}
.markdown-content :deep(tbody tr:nth-child(even) td) {
  background: rgba(246, 248, 251, .58);
}
.markdown-content-data :deep(table) {
  min-width: 420px;
  font-size: var(--type-size-caption);
}
.markdown-content-data :deep(th:first-child),
.markdown-content-data :deep(td:first-child) {
  position: sticky;
  left: 0;
  z-index: 1;
  background: rgba(244, 247, 251, .98);
  font-weight: var(--type-weight-semibold);
}
.markdown-content-data :deep(th:first-child) {
  z-index: 2;
  background: rgba(221, 229, 241, .98);
}
.markdown-content-data :deep(svg),
.markdown-content-data :deep(img) {
  width: 100%;
  max-width: 680px;
  min-width: 0;
  height: auto;
  max-height: 280px;
  margin: 10px auto;
  object-fit: contain;
}
.markdown-content-compact {
  font-size: var(--type-size-secondary);
  line-height: 1.58;
}
.markdown-content-compact :deep(p),
.markdown-content-compact :deep(ul),
.markdown-content-compact :deep(ol),
.markdown-content-compact :deep(blockquote),
.markdown-content-compact :deep(pre),
.markdown-content-compact :deep(.markdown-table-scroll) {
  margin-top: 6px;
  margin-bottom: 6px;
}
.markdown-content-chat {
  overflow-wrap: anywhere;
  line-height: 1.58;
}
.markdown-content-chat :deep(p) { margin: 0; }
.markdown-content-chat :deep(p + p),
.markdown-content-chat :deep(ul),
.markdown-content-chat :deep(ol),
.markdown-content-chat :deep(blockquote),
.markdown-content-chat :deep(pre),
.markdown-content-chat :deep(.markdown-table-scroll) { margin: 8px 0 0; }
.markdown-content-chat :deep(h1),
.markdown-content-chat :deep(h2),
.markdown-content-chat :deep(h3),
.markdown-content-chat :deep(h4) { margin: 10px 0 6px; font-size: var(--type-size-body-large); line-height: 1.35; }
.markdown-content-chat :deep(pre) {
  border: 1px solid rgba(var(--color-ink-rgb), .07);
  border-radius: 9px;
  background: rgba(250, 251, 253, .86);
}
.markdown-content-chat :deep(code) {
  border: 1px solid rgba(var(--color-ink-rgb), .07);
  background: rgba(255, 255, 255, .52);
}
.markdown-content-chat :deep(pre code) { border: 0; background: transparent; }
.markdown-content-chat :deep(blockquote) { border-left-width: 2px; }
.markdown-content :deep(.markdown-stopped-note),
.markdown-content :deep(.markdown-stopped-empty) {
  color: #b3261e;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

@media (max-width: 600px) {
  .markdown-content :deep(.markdown-table-scroll) {
    overflow-x: hidden;
  }
  .markdown-content :deep(table),
  .markdown-content-data :deep(table) {
    width: 100%;
    min-width: 0;
    table-layout: fixed;
  }
  .markdown-content :deep(th),
  .markdown-content :deep(td) {
    padding: 7px 5px;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .markdown-content-data :deep(th:first-child),
  .markdown-content-data :deep(td:first-child) {
    position: static;
  }
}
</style>
