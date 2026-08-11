<template>
  <footer :class="['sticky-action-bar', { 'avoid-bottom-nav': avoidBottomNav }]">
    <slot></slot>
  </footer>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  avoidBottomNav?: boolean;
}>(), {
  avoidBottomNav: false
});
</script>

<style scoped>
.sticky-action-bar {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  gap: 10px;
  padding: 10px var(--page-x) calc(10px + var(--app-safe-bottom));
  background: var(--surface-header);
  box-shadow: 0 -10px 24px rgba(28, 38, 58, .05);
}

.sticky-action-bar.avoid-bottom-nav {
  margin-bottom: var(--app-bottom-nav-reserved);
  padding-bottom: 10px;
}

.sticky-action-bar :deep(button) {
  min-height: 44px;
  border: none;
  border-radius: var(--radius-control);
  padding: 0 16px;
  background: var(--surface-control);
  color: var(--text-color);
  font: inherit;
  font-weight: var(--type-weight-medium);
}

.sticky-action-bar :deep(button.primary) {
  flex: 1;
  background: var(--primary-color);
  color: var(--color-text-inverse);
}

.sticky-action-bar :deep(button:disabled) {
  opacity: .52;
}
</style>
