<template>
  <button
    :class="[
      'floating-action-button',
      {
        'avoid-bottom-nav': avoidBottomNav,
        'has-status': hasStatus,
        busy
      }
    ]"
    type="button"
    :aria-label="label"
    :aria-busy="busy"
    :title="title || label"
    :disabled="disabled"
  >
    <slot></slot>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  label: string;
  title?: string;
  avoidBottomNav?: boolean;
  hasStatus?: boolean;
  busy?: boolean;
  disabled?: boolean;
}>(), {
  title: '',
  avoidBottomNav: false,
  hasStatus: false,
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
  width: 46px;
  height: 46px;
  border: 1px solid rgba(255, 255, 255, .38);
  border-radius: var(--radius-pill);
  padding: 0;
  display: grid;
  place-items: center;
  color: var(--primary-color);
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, .54),
    rgba(255, 255, 255, .76) 48%,
    rgba(var(--color-brand-rgb), .16)
  );
  box-shadow:
    0 10px 26px rgba(var(--color-ink-rgb), .11),
    inset 0 1px 0 rgba(255, 255, 255, .56);
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
    inset 0 1px 0 rgba(255, 255, 255, .5);
}

.floating-action-button:disabled {
  opacity: .42;
}

.floating-action-button :deep(svg) {
  width: 21px;
  height: 21px;
  stroke-width: 2;
}

.floating-action-button.has-status::after {
  content: '';
  position: absolute;
  top: 5px;
  right: 5px;
  width: 7px;
  height: 7px;
  border: 2px solid rgba(255, 255, 255, .82);
  border-radius: var(--radius-pill);
  background: var(--primary-color);
}

.floating-action-button.busy {
  animation: floating-action-pulse 1.2s ease-in-out infinite;
}

@keyframes floating-action-pulse {
  50% { opacity: .68; }
}
</style>
