<template>
  <section class="book-index" aria-label="页面模块导航">
    <div class="book-index-copy">
      <span>{{ eyebrow }}</span>
      <strong>{{ title }}</strong>
      <em>{{ subtitle }}</em>
    </div>
    <div class="book-index-list">
      <button
        v-for="(item, index) in items"
        :key="item.key || item.title"
        type="button"
        class="book-index-item"
        @click="jumpTo(item.targetId)"
      >
        <i>{{ String(index + 1).padStart(2, '0') }}</i>
        <span>
          <strong>{{ item.title }}</strong>
          <em>{{ item.description }}</em>
        </span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
export interface BookIndexItem {
  key?: string;
  title: string;
  description: string;
  targetId?: string;
}

withDefaults(defineProps<{
  eyebrow?: string;
  title: string;
  subtitle: string;
  items: BookIndexItem[];
}>(), {
  eyebrow: '目录'
});

function jumpTo(targetId?: string) {
  if (!targetId) return;
  document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>

<style scoped>
.book-index {
  padding: 13px 14px;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(247, 249, 252, .72);
}

.book-index-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.book-index-copy span {
  color: var(--primary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.book-index-copy strong {
  color: var(--text-color);
  font-size: var(--type-size-control);
  line-height: 1.25;
}

.book-index-copy em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
  line-height: 1.45;
}

.book-index-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.book-index-item {
  min-width: 0;
  min-height: 58px;
  border: 1px solid rgba(var(--color-ink-rgb), .055);
  border-radius: 12px;
  padding: 9px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: rgba(255, 255, 255, .68);
  color: inherit;
  text-align: left;
  font-family: inherit;
}

.book-index-item:active {
  transform: scale(.99);
}

.book-index-item i {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(var(--color-brand-rgb), .09);
  color: var(--primary-color);
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}

.book-index-item span {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.book-index-item strong,
.book-index-item em {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-index-item strong {
  color: var(--text-color);
  font-size: var(--type-size-caption);
  line-height: 1.25;
}

.book-index-item em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}

@media (max-width: 360px) {
  .book-index-list {
    grid-template-columns: 1fr;
  }
}
</style>
