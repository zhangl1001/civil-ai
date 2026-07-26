<template>
  <main
    class="app-page-scroll pull-refresh"
    :class="{ pulling: pullDistance > 0, refreshing: isRefreshing }"
    :style="{ '--pull-distance': `${pullDistance}px` }"
    @touchstart.passive="handleTouchStart"
    @touchmove.passive="handleTouchMove"
    @touchend="handleTouchEnd"
    @touchcancel="resetPull"
  >
    <div class="pull-refresh-indicator" aria-hidden="true">
      <span>{{ isRefreshing ? '刷新中' : pullDistance >= threshold ? '松开刷新' : '下拉刷新' }}</span>
    </div>
    <div class="pull-refresh-content">
      <slot />
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(defineProps<{
  onRefresh?: () => Promise<void> | void;
  threshold?: number;
}>(), {
  threshold: 64
});

const pullDistance = ref(0);
const isRefreshing = ref(false);
let startY = 0;
let tracking = false;

function handleTouchStart(event: TouchEvent) {
  if (isRefreshing.value) return;
  const target = event.currentTarget as HTMLElement;
  if (target.scrollTop > 0) return;
  tracking = true;
  startY = event.touches[0]?.clientY ?? 0;
}

function handleTouchMove(event: TouchEvent) {
  if (!tracking || isRefreshing.value) return;
  const y = event.touches[0]?.clientY ?? startY;
  const delta = y - startY;
  if (delta <= 0) {
    pullDistance.value = 0;
    return;
  }
  pullDistance.value = Math.min(96, Math.round(delta * 0.45));
}

async function handleTouchEnd() {
  if (!tracking) return;
  tracking = false;
  if (pullDistance.value < props.threshold || !props.onRefresh) {
    resetPull();
    return;
  }
  isRefreshing.value = true;
  pullDistance.value = props.threshold;
  try {
    await props.onRefresh();
  } finally {
    isRefreshing.value = false;
    resetPull();
  }
}

function resetPull() {
  tracking = false;
  if (!isRefreshing.value) pullDistance.value = 0;
}
</script>

<style scoped>
.pull-refresh {
  position: relative;
}

.pull-refresh-content {
  min-height: 100%;
  padding-bottom: var(--pull-refresh-bottom-reserved, 0px);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: inherit;
  transform: translateY(var(--pull-distance));
  transition: transform .18s ease;
}

.pull-refresh.pulling .pull-refresh-content,
.pull-refresh.refreshing .pull-refresh-content {
  transition: transform .08s ease;
}

.pull-refresh-indicator {
  position: absolute;
  top: 8px;
  left: 50%;
  z-index: 1;
  height: 26px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 11px;
  background: rgba(255, 255, 255, .78);
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
  box-shadow: 0 8px 18px rgba(28, 38, 58, .08);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, calc(-100% + var(--pull-distance)));
  transition: opacity .12s ease, transform .12s ease;
}

.pull-refresh.pulling .pull-refresh-indicator,
.pull-refresh.refreshing .pull-refresh-indicator {
  opacity: 1;
}
</style>
