<template>
  <div class="content-document-renderer">
    <template v-for="block in document.blocks" :key="block.id">
      <MarkdownContent v-if="block.type === 'markdown'" :content="block.source" :variant="markdownVariant" />

      <figure v-else-if="block.type === 'data_table'" class="content-table">
        <figcaption v-if="block.caption || block.unit">{{ block.caption }}<small v-if="block.unit">{{ block.unit }}</small></figcaption>
        <div class="content-table-scroll"><table><thead><tr><th v-for="column in block.columns" :key="column.key" :style="{ textAlign: column.alignment }">{{ column.label }}</th></tr></thead><tbody><tr v-for="(row, index) in block.rows" :key="index"><td v-for="column in block.columns" :key="column.key" :style="{ textAlign: column.alignment }">{{ row[column.key] ?? '-' }}</td></tr></tbody></table></div>
        <p v-if="block.sourceNote" class="content-source-note">{{ block.sourceNote }}</p>
      </figure>

      <figure v-else-if="block.type === 'svg_diagram'" class="content-diagram"><div class="content-svg" role="img" :aria-label="block.alt" v-html="sanitizeSvg(block.markup)"></div><figcaption>{{ block.alt }}</figcaption></figure>

      <figure v-else-if="block.type === 'image'" class="content-image"><img v-if="safeImage(block.assetRef)" :src="safeImage(block.assetRef)" :alt="block.alt" loading="lazy" /><figcaption v-if="block.caption">{{ block.caption }}</figcaption><span v-else-if="!safeImage(block.assetRef)" class="content-image-unavailable">图片资源不可用：{{ block.alt }}</span></figure>

      <code v-else-if="block.type === 'formula'" :class="['content-formula', `content-formula-${block.display}`]">{{ block.source }}</code>

      <aside v-else class="content-callout" :class="`content-callout-${block.kind}`"><strong v-if="block.title">{{ block.title }}</strong><ContentDocumentRenderer :document="{ schemaVersion: document.schemaVersion, blocks: block.blocks }" :markdown-variant="markdownVariant" /></aside>
    </template>
  </div>
</template>

<script setup lang="ts">
import { HtmlPolicy } from '@/capabilities/content-rendering/public';
import type { ContentDocument } from '@/modules/content/public';
import MarkdownContent from '@/components/MarkdownContent.vue';

defineOptions({ name: 'ContentDocumentRenderer' });
withDefaults(defineProps<{ readonly document: ContentDocument; readonly markdownVariant?: 'default' | 'compact' | 'data' }>(), { markdownVariant: 'default' });
const htmlPolicy = new HtmlPolicy();
function sanitizeSvg(value: string): string { return htmlPolicy.sanitize(value); }
function safeImage(value: string): string | undefined { return /^(https?:\/\/|\/|data:image\/)/i.test(value) ? value : undefined; }
</script>

<style scoped>
.content-document-renderer { display:flex; flex-direction:column; gap:10px; min-width:0; }.content-table,.content-diagram,.content-image { margin:0; }.content-table figcaption,.content-diagram figcaption,.content-image figcaption { margin-bottom:6px; color:var(--text-secondary-color); font-size:var(--type-size-caption); }.content-table figcaption small { margin-left:6px; font-size:inherit; }.content-table-scroll { overflow-x:auto; border-radius:8px; background:rgba(var(--color-ink-rgb),.035); -webkit-overflow-scrolling:touch; }.content-table table { width:100%; min-width:400px; border-collapse:collapse; font-size:var(--type-size-caption); }.content-table th,.content-table td { padding:8px 9px; border-bottom:1px solid rgba(var(--color-ink-rgb),.07); white-space:nowrap; }.content-table th { color:var(--text-color); background:rgba(var(--color-ink-rgb),.045); font-weight:var(--type-weight-semibold); }.content-source-note { margin:5px 0 0; color:var(--text-secondary-color); font-size:var(--type-size-micro); }.content-svg { width:100%; max-height:260px; overflow:hidden; display:grid; place-items:center; border-radius:8px; background:rgba(var(--color-ink-rgb),.025); }.content-svg :deep(svg) { display:block; width:100%; height:auto; max-height:260px; }.content-diagram figcaption { margin-top:5px; text-align:center; }.content-image img { display:block; width:100%; max-height:340px; object-fit:contain; border-radius:8px; }.content-image-unavailable { color:var(--text-secondary-color); font-size:var(--type-size-caption); }.content-formula { font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:var(--type-size-secondary); }.content-formula-block { display:block; padding:9px 10px; overflow-x:auto; border-radius:8px; background:rgba(var(--color-ink-rgb),.055); }.content-callout { padding:10px 11px; border-left:3px solid var(--primary-color); border-radius:0 8px 8px 0; background:rgba(var(--color-brand-rgb),.06); }.content-callout>strong { display:block; margin-bottom:5px; font-size:var(--type-size-secondary); }.content-callout-trap,.content-callout-wrong_cause { border-left-color:var(--orange-color); background:rgba(255,149,0,.08); }.content-callout-conclusion { border-left-color:var(--green-color); background:rgba(52,199,89,.08); }
</style>
