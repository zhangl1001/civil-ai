<template>
  <div
    ref="rootRef"
    class="floating-bubble-switcher"
    :class="{ 'is-dragging': isDragging, 'is-switching': isSwitching }"
    :style="{ transform: `translate3d(0, ${offsetY}px, 0)` }"
    :aria-label="ariaLabel"
    @pointerdown="startDrag"
  >
    <button
      class="primary-bubble"
      type="button"
      :aria-label="nextOption ? `当前为${activeOption?.label}，切换到${nextOption.label}` : activeOption?.label"
      @click="selectNext"
    >
      <Transition name="bubble-swap" mode="out-in">
        <component
          :is="activeOption.icon"
          v-if="activeOption?.icon"
          :key="`icon-${activeOption.index}`"
          aria-hidden="true"
        />
        <span v-else-if="activeOption" :key="`text-${activeOption.index}`">{{ activeOption.text || activeOption.label }}</span>
      </Transition>
    </button>

    <TransitionGroup name="bubble-option" tag="div" class="secondary-bubbles">
      <button
        v-for="item in inactiveOptions"
        :key="item.index"
        class="secondary-bubble"
        type="button"
        :aria-label="`切换到${item.label}`"
        @click="activate(item.index)"
      >
        <component :is="item.icon" v-if="item.icon" aria-hidden="true" />
        <span v-else>{{ item.text || item.label }}</span>
      </button>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { FloatingBubbleSwitcherOption } from './FloatingBubbleSwitcher.types';

const props = withDefaults(defineProps<{
  modelValue: number;
  options: readonly FloatingBubbleSwitcherOption[];
  ariaLabel?: string;
  draggable?: boolean;
  dragTopInset?: number;
  dragBottomInset?: number;
}>(), {
  ariaLabel: '功能切换',
  draggable: false,
  dragTopInset: 88,
  dragBottomInset: 96
});

const emit = defineEmits<{
  'update:modelValue': [index: number];
}>();

const activePosition = computed(() => {
  const position = props.options.findIndex((option) => option.index === props.modelValue);
  return position >= 0 ? position : 0;
});

const activeOption = computed(() => props.options[activePosition.value]);
const inactiveOptions = computed(() => props.options
  .filter((option) => option.index !== activeOption.value?.index));
const nextPosition = computed(() => props.options.length < 2
  ? undefined
  : (activePosition.value + 1) % props.options.length);
const nextOption = computed(() => nextPosition.value === undefined ? undefined : props.options[nextPosition.value]);
const rootRef = ref<HTMLElement>();
const offsetY = ref(0);
const isDragging = ref(false);
const isSwitching = ref(false);

let pointerId: number | undefined;
let pointerStartY = 0;
let offsetAtDragStart = 0;
let minimumOffset = 0;
let maximumOffset = 0;
let movedDuringGesture = false;
let suppressClickUntil = 0;
let switchTimer: ReturnType<typeof setTimeout> | undefined;

function select(index: number): void {
  if (index === activeOption.value?.index) return;
  isSwitching.value = true;
  if (switchTimer) clearTimeout(switchTimer);
  switchTimer = setTimeout(() => {
    isSwitching.value = false;
  }, 420);
  emit('update:modelValue', index);
}

function activate(index: number): void {
  if (performance.now() < suppressClickUntil) return;
  select(index);
}

function selectNext(): void {
  if (nextOption.value) activate(nextOption.value.index);
}

function startDrag(event: PointerEvent): void {
  if (!props.draggable || event.button !== 0 || !rootRef.value) return;
  const rect = rootRef.value.getBoundingClientRect();
  pointerId = event.pointerId;
  pointerStartY = event.clientY;
  offsetAtDragStart = offsetY.value;
  minimumOffset = offsetAtDragStart + props.dragTopInset - rect.top;
  maximumOffset = offsetAtDragStart + window.innerHeight - props.dragBottomInset - rect.bottom;
  movedDuringGesture = false;
  rootRef.value.setPointerCapture(event.pointerId);
  window.addEventListener('pointermove', drag, { passive: false });
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

function drag(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return;
  const delta = event.clientY - pointerStartY;
  if (Math.abs(delta) > 12) {
    movedDuringGesture = true;
    isDragging.value = true;
  }
  if (!movedDuringGesture) return;
  event.preventDefault();
  offsetY.value = Math.min(maximumOffset, Math.max(minimumOffset, offsetAtDragStart + delta));
}

function endDrag(event: PointerEvent): void {
  if (event.pointerId !== pointerId) return;
  if (movedDuringGesture) {
    event.preventDefault();
    suppressClickUntil = performance.now() + 350;
  }
  rootRef.value?.releasePointerCapture(event.pointerId);
  pointerId = undefined;
  isDragging.value = false;
  removeDragListeners();
}

function removeDragListeners(): void {
  window.removeEventListener('pointermove', drag);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
}

onBeforeUnmount(() => {
  removeDragListeners();
  if (switchTimer) clearTimeout(switchTimer);
});
</script>

<style scoped>
.floating-bubble-switcher {
  position: relative;
  width: 58px;
  height: 58px;
  isolation: isolate;
  touch-action: none;
  user-select: none;
  transition: transform .18s ease;
  will-change: transform;
}

.floating-bubble-switcher.is-dragging {
  transition: none;
}

.primary-bubble,
.secondary-bubble {
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(var(--color-surface-rgb), .5);
  color: var(--primary-color);
  background: rgba(var(--color-surface-rgb), .54);
  box-shadow:
    inset 4px 5px 10px rgba(var(--color-surface-rgb), .38),
    inset -3px -4px 8px rgba(var(--color-brand-rgb), .08),
    0 8px 20px rgba(var(--color-ink-rgb), .08);
  backdrop-filter: blur(14px) saturate(1.1);
  -webkit-backdrop-filter: blur(14px) saturate(1.1);
  transition: transform .2s ease, border-radius .24s ease, background-color .2s ease, box-shadow .2s ease;
}

.primary-bubble {
  position: absolute;
  left: 0;
  bottom: 0;
  z-index: 2;
  width: 48px;
  height: 48px;
  border-radius: 54% 46% 50% 50% / 47% 53% 47% 53%;
  border-color: rgba(var(--color-surface-rgb), .42);
  background: rgba(var(--color-surface-rgb), .46);
}

.primary-bubble::after {
  position: absolute;
  top: 7px;
  left: 9px;
  width: 10px;
  height: 5px;
  border-radius: 999px;
  background: rgba(var(--color-surface-rgb), .44);
  content: '';
  transform: rotate(-25deg);
  pointer-events: none;
}

.primary-bubble :deep(svg) {
  width: 22px;
  height: 22px;
  stroke-width: 2;
}

.primary-bubble > span {
  font-size: var(--type-size-body);
  font-weight: var(--type-weight-semibold);
  line-height: 1;
}

.secondary-bubbles {
  position: absolute;
  top: -3px;
  left: -2px;
  z-index: 3;
  display: flex;
  align-items: center;
}

.secondary-bubble {
  width: 28px;
  height: 28px;
  margin-left: -4px;
  border-radius: 58% 42% 55% 45% / 42% 57% 43% 58%;
  border-color: rgba(var(--color-surface-rgb), .24);
  color: var(--text-tertiary-color);
  background: rgba(var(--color-surface-rgb), .22);
  box-shadow:
    inset 2px 3px 6px rgba(var(--color-surface-rgb), .16),
    0 4px 10px rgba(var(--color-ink-rgb), .035);
  opacity: .48;
  transform: rotate(-8deg);
}

.secondary-bubble:first-child {
  margin-left: 0;
}

.secondary-bubble :deep(svg) {
  width: 14px;
  height: 14px;
  stroke-width: 2;
  transform: rotate(8deg);
}

.secondary-bubble > span {
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
  line-height: 1;
  transform: rotate(8deg);
}

.primary-bubble:active,
.secondary-bubble:active {
  transform: scale(.9);
}

.secondary-bubble:active {
  transform: rotate(-8deg) scale(.88);
}

.floating-bubble-switcher.is-switching .primary-bubble {
  animation: liquid-morph .42s cubic-bezier(.2, .8, .2, 1);
}

.primary-bubble:focus-visible,
.secondary-bubble:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.bubble-swap-enter-active,
.bubble-swap-leave-active,
.bubble-option-enter-active,
.bubble-option-leave-active,
.bubble-option-move {
  transition: opacity .16s ease, transform .22s cubic-bezier(.2, .8, .2, 1);
}

.bubble-swap-enter-from {
  opacity: 0;
  transform: scale(.55) rotate(18deg);
}

.bubble-swap-leave-to {
  opacity: 0;
  transform: scale(.72) rotate(-14deg);
}

.bubble-option-enter-from,
.bubble-option-leave-to {
  opacity: 0;
  transform: translate(10px, 14px) rotate(20deg) scale(.28);
}

.bubble-option-leave-active {
  position: absolute;
}

@keyframes liquid-morph {
  0% {
    border-radius: 54% 46% 50% 50% / 47% 53% 47% 53%;
    transform: scale(1);
  }
  35% {
    border-radius: 44% 56% 42% 58% / 58% 43% 57% 42%;
    transform: scale(.91, 1.06) rotate(-3deg);
  }
  68% {
    border-radius: 59% 41% 57% 43% / 43% 58% 42% 57%;
    transform: scale(1.05, .94) rotate(2deg);
  }
  100% {
    border-radius: 54% 46% 50% 50% / 47% 53% 47% 53%;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .primary-bubble,
  .secondary-bubble,
  .bubble-swap-enter-active,
  .bubble-swap-leave-active,
  .bubble-option-enter-active,
  .bubble-option-leave-active,
  .bubble-option-move {
    transition: none;
  }

  .floating-bubble-switcher.is-switching .primary-bubble {
    animation: none;
  }
}
</style>
