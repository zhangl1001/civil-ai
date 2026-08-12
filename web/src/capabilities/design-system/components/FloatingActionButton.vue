<template>
  <button
    :class="[
      'floating-action-button',
      {
        'avoid-bottom-nav': avoidBottomNav,
        busy
      }
    ]"
    type="button"
    :aria-label="ariaLabel || label"
    :aria-busy="busy"
    :title="title || label"
    :disabled="disabled"
  >
    <span class="floating-action-icon"><slot></slot></span>
    <span class="floating-action-label">{{ label }}</span>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  label: string;
  ariaLabel?: string;
  title?: string;
  avoidBottomNav?: boolean;
  busy?: boolean;
  disabled?: boolean;
}>(), {
  title: '',
  ariaLabel: '',
  avoidBottomNav: false,
  busy: false,
  disabled: false
});
</script>

<style scoped>
.floating-action-button {
  position: fixed;
  left: max(14px, env(safe-area-inset-left));
  bottom: max(8px, var(--app-safe-bottom));
  z-index: 12;
  min-width: var(--app-floating-action-height);
  max-width: calc(100vw - max(28px, env(safe-area-inset-left) + env(safe-area-inset-right)));
  height: var(--app-floating-action-height);
  border: 1px solid rgba(var(--color-surface-rgb), .38);
  border-radius: var(--radius-pill);
  padding: 0 14px 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--primary-color);
  background: linear-gradient(
    180deg,
    rgba(var(--color-surface-rgb), .54),
    rgba(var(--color-surface-rgb), .76) 48%,
    rgba(var(--color-brand-rgb), .16)
  );
  box-shadow:
    0 10px 26px rgba(var(--color-ink-rgb), .11),
    inset 0 1px 0 rgba(var(--color-surface-rgb), .56);
  backdrop-filter: blur(14px) saturate(1.08);
  -webkit-backdrop-filter: blur(14px) saturate(1.08);
  transition:
    transform var(--motion-fast) ease,
    opacity var(--motion-fast) ease,
    box-shadow var(--motion-fast) ease;
}

.floating-action-button.avoid-bottom-nav {
  bottom: calc(var(--app-bottom-nav-reserved) + 2px);
}

.floating-action-button:active:not(:disabled) {
  transform: scale(.94);
  box-shadow:
    0 6px 18px rgba(var(--color-ink-rgb), .1),
    inset 0 1px 0 rgba(var(--color-surface-rgb), .5);
}

.floating-action-button:disabled {
  opacity: .42;
}

.floating-action-icon {
  width: 21px;
  height: 21px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.floating-action-icon :deep(svg) {
  width: 21px;
  height: 21px;
  stroke-width: 2;
}

.floating-action-label {
  min-width: 0;
  overflow: hidden;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.floating-action-button.busy {
  animation: floating-action-pulse 1.2s ease-in-out infinite;
}

@keyframes floating-action-pulse {
  50% { opacity: .68; }
}
</style>
