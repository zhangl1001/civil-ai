<template>
  <component :is="as" class="surface-card" :class="[`surface-card-${variant}`, { compact, interactive }]">
    <header v-if="title || $slots.meta || $slots.header" class="surface-card-header">
      <slot name="header">
        <h2 v-if="title">{{ title }}</h2>
        <div v-if="$slots.meta" class="surface-card-meta">
          <slot name="meta" />
        </div>
      </slot>
    </header>
    <div class="surface-card-content">
      <slot />
    </div>
  </component>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  as?: string;
  title?: string;
  compact?: boolean;
  interactive?: boolean;
  variant?: 'default' | 'strong' | 'muted';
}>(), {
  as: 'div',
  compact: false,
  interactive: false,
  variant: 'default'
});
</script>

<style scoped>
.surface-card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-card);
  padding: 14px;
  background: var(--surface-card);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(16px) saturate(1.08);
  -webkit-backdrop-filter: blur(16px) saturate(1.08);
}

.surface-card-strong {
  background: var(--surface-card-strong);
}

.surface-card-muted {
  background: rgba(var(--color-ink-rgb), .045);
}

.surface-card.compact {
  padding: 10px 12px;
}

.surface-card.interactive {
  transition: transform var(--motion-fast) ease, box-shadow var(--motion-fast) ease;
}

.surface-card.interactive:active {
  transform: scale(.99);
}

.surface-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.surface-card-header h2 {
  margin: 0;
  color: var(--text-color);
  font-size: var(--type-size-body-large);
  font-weight: var(--type-weight-semibold);
  line-height: var(--type-line-title);
}

.surface-card-meta {
  color: var(--color-text-secondary);
  font-size: var(--type-size-micro);
}

.surface-card-content {
  min-width: 0;
}
</style>
