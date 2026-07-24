<template>
  <div class="app-background" aria-hidden="true">
    <div class="app-background-grid"></div>
  </div>
</template>

<style scoped>
.app-background {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: var(--surface-canvas);
  transform: translateZ(0);
}

.app-background::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--theme-background-image, none);
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  opacity: var(--theme-background-image-opacity, 0);
}

.app-background::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--theme-background-scrim, transparent);
}

.app-background-grid {
  position: absolute;
  inset: 0;
  opacity: var(--theme-grid-opacity, .34);
  background-image:
    linear-gradient(var(--border-subtle) 1px, transparent 1px),
    linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
  background-size: 22px 22px;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, .48), transparent 62%);
}
</style>
