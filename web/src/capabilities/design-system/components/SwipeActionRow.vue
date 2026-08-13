<template>
  <div
    ref="root"
    class="swipe-action-row"
    :class="{ dragging, open: isOpen, disabled }"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="finishPointer"
    @pointercancel="cancelPointer"
    @keydown.esc="close"
  >
    <div class="swipe-actions" :style="{ width: `${actionAreaWidth}px` }">
      <button
        v-for="action in actions"
        :key="action.id"
        type="button"
        :class="['swipe-action', action.tone || 'default']"
        :aria-label="action.ariaLabel || action.label"
        :disabled="disabled || action.disabled"
        @focus="open"
        @click.stop="runAction(action.id)"
      >
        <component :is="action.icon" v-if="action.icon" />
        <span>{{ action.label }}</span>
      </button>
    </div>
    <div
      class="swipe-foreground"
      :style="{ transform: `translate3d(${offset}px, 0, 0)` }"
      @click.capture="handleForegroundClick"
    >
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { SwipeActionRowAction } from './SwipeActionRow.types';

const ACTION_WIDTH = 76;
const OPEN_THRESHOLD_RATIO = .36;
const DIRECTION_LOCK_PX = 5;
const OPEN_EVENT = 'design-system:swipe-action-open';

const props = withDefaults(defineProps<{
  actions: readonly SwipeActionRowAction[];
  disabled?: boolean;
}>(), {
  disabled: false
});

const emit = defineEmits<{
  action: [actionId: string];
}>();

const root = ref<HTMLElement | null>(null);
const offset = ref(0);
const dragging = ref(false);
const actionAreaWidth = computed(() => Math.max(0, props.actions.length * ACTION_WIDTH));
const isOpen = computed(() => offset.value < 0);

let pointerId: number | null = null;
let startX = 0;
let startY = 0;
let startOffset = 0;
let horizontalGesture = false;
let moved = false;

onMounted(() => window.addEventListener(OPEN_EVENT, handleAnotherRowOpened as EventListener));
onBeforeUnmount(() => window.removeEventListener(OPEN_EVENT, handleAnotherRowOpened as EventListener));

function handlePointerDown(event: PointerEvent) {
  if (props.disabled || !props.actions.length || event.button !== 0) return;
  pointerId = event.pointerId;
  startX = event.clientX;
  startY = event.clientY;
  startOffset = offset.value;
  horizontalGesture = false;
  moved = false;
}

function handlePointerMove(event: PointerEvent) {
  if (pointerId !== event.pointerId || props.disabled) return;
  const deltaX = event.clientX - startX;
  const deltaY = event.clientY - startY;
  if (!horizontalGesture) {
    if (Math.abs(deltaX) < DIRECTION_LOCK_PX && Math.abs(deltaY) < DIRECTION_LOCK_PX) return;
    if (Math.abs(deltaY) >= Math.abs(deltaX)) {
      pointerId = null;
      return;
    }
    horizontalGesture = true;
    dragging.value = true;
    root.value?.setPointerCapture(event.pointerId);
  }
  event.preventDefault();
  moved = moved || Math.abs(deltaX) > DIRECTION_LOCK_PX;
  offset.value = clamp(startOffset + deltaX, -actionAreaWidth.value, 0);
}

function finishPointer(event: PointerEvent) {
  if (pointerId !== event.pointerId) return;
  if (horizontalGesture) {
    const shouldOpen = Math.abs(offset.value) >= actionAreaWidth.value * OPEN_THRESHOLD_RATIO;
    shouldOpen ? open() : close();
  }
  releasePointer(event.pointerId);
}

function cancelPointer(event: PointerEvent) {
  if (pointerId !== event.pointerId) return;
  close();
  releasePointer(event.pointerId);
}

function releasePointer(id: number) {
  if (root.value?.hasPointerCapture(id)) root.value.releasePointerCapture(id);
  pointerId = null;
  horizontalGesture = false;
  dragging.value = false;
  window.setTimeout(() => { moved = false; }, 0);
}

function handleForegroundClick(event: MouseEvent) {
  if (!moved && !isOpen.value) return;
  event.preventDefault();
  event.stopPropagation();
  close();
}

function open() {
  if (props.disabled || !actionAreaWidth.value) return;
  offset.value = -actionAreaWidth.value;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: root.value }));
}

function close() {
  offset.value = 0;
}

function runAction(actionId: string) {
  close();
  emit('action', actionId);
}

function handleAnotherRowOpened(event: CustomEvent<HTMLElement | null>) {
  if (event.detail !== root.value) close();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
</script>

<style scoped>
.swipe-action-row {
  position: relative;
  overflow: hidden;
  width: 100%;
  touch-action: pan-y;
}

.swipe-actions {
  position: absolute;
  inset: 0 0 0 auto;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 76px;
}

.swipe-action {
  min-width: 0;
  border: 0;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--text-color);
  background: var(--surface-muted);
  font: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.swipe-action.danger {
  color: #fff;
  background: var(--red-color);
}

.swipe-action:disabled {
  opacity: .45;
}

.swipe-action svg {
  width: 18px;
  height: 18px;
}

.swipe-foreground {
  position: relative;
  z-index: 1;
  min-width: 0;
  background: inherit;
  transition: transform .2s cubic-bezier(.22, .8, .25, 1);
  will-change: transform;
}

.dragging .swipe-foreground {
  transition: none;
}

.disabled {
  touch-action: auto;
}

@media (prefers-reduced-motion: reduce) {
  .swipe-foreground { transition-duration: .01ms; }
}
</style>
