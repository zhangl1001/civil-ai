<template>
  <div class="header-more-menu" ref="rootRef">
    <button class="header-more-button icon-button" type="button" :aria-label="title" @click.stop="isOpen = !isOpen">
      <MoreVerticalIcon />
    </button>
    <Teleport to="body">
      <Transition name="header-more-pop">
        <div v-if="isOpen" class="header-more-layer" @click.self="isOpen = false">
          <div class="header-more-popover" role="menu" @click="isOpen = false">
            <div class="header-more-title">
              <strong>{{ title }}</strong>
              <span v-if="subtitle">{{ subtitle }}</span>
            </div>
            <div class="header-more-content">
              <slot></slot>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { MoreVerticalIcon } from 'lucide-vue-next';

withDefaults(defineProps<{
  title?: string;
  subtitle?: string;
}>(), {
  title: '更多操作'
});

const isOpen = ref(false);
const rootRef = ref<HTMLElement | null>(null);

onMounted(() => {
  document.addEventListener('click', handleOutsideClick);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick);
});

function handleOutsideClick(event: MouseEvent) {
  if (!isOpen.value) return;
  const target = event.target as Node;
  if (rootRef.value?.contains(target)) return;
  isOpen.value = false;
}

defineExpose({
  close: () => {
    isOpen.value = false;
  }
});
</script>

<style scoped>
.header-more-menu {
  position: relative;
  display: inline-flex;
}

.header-more-button svg {
  width: 18px;
  height: 18px;
}

.header-more-layer {
  position: fixed;
  inset: 0;
  z-index: 88;
  padding: calc(54px + var(--app-safe-top)) 12px 0;
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
  background: rgba(var(--color-ink-rgb), .035);
}

.header-more-popover {
  width: min(250px, calc(100vw - 40px));
  max-height: min(62dvh, 420px);
  overflow-y: auto;
  border: none;
  border-radius: 16px;
  padding: 10px;
  background: var(--app-sheet-bg);
  box-shadow: 0 14px 34px rgba(28, 38, 58, .12);
}

.header-more-title {
  padding: 2px 4px 9px;
}

.header-more-title strong,
.header-more-title span {
  display: block;
}

.header-more-title strong {
  color: var(--text-color);
  font-size: var(--type-size-secondary);
}

.header-more-title span {
  margin-top: 2px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}

.header-more-content {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.header-more-content :deep(button.menu-row) {
  width: 100%;
  min-height: 40px;
  border: none;
  border-radius: 11px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  background: transparent;
  color: var(--text-color);
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
  font-family: inherit;
  text-align: left;
}

.header-more-content :deep(button.menu-row svg) {
  width: 16px;
  height: 16px;
  color: var(--primary-color);
  flex-shrink: 0;
}

.header-more-content :deep(button.menu-row.danger) {
  color: var(--red-color);
  background: rgba(255, 59, 48, .06);
}

.header-more-content :deep(button.menu-row.danger svg) {
  color: var(--red-color);
}

.header-more-content :deep(.menu-field) {
  width: 100%;
  box-sizing: border-box;
  border: none;
  border-radius: 12px;
  padding: 10px;
  background: rgba(255, 255, 255, .38);
}

.header-more-pop-enter-active,
.header-more-pop-leave-active {
  transition: opacity .16s ease, transform .16s ease;
}

.header-more-pop-enter-from,
.header-more-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(.98);
}
</style>
