<template>
  <Teleport to="body">
    <Transition name="center-dialog-fade">
      <div v-if="modelValue" class="center-dialog-overlay" @click.self="close">
        <Transition name="center-dialog-pop" appear>
          <section :class="['center-dialog-card', `center-dialog-${variant}`]" role="dialog" aria-modal="true" :aria-label="title || '内容弹窗'">
            <header v-if="title || subtitle || closeable" class="center-dialog-header">
              <div>
                <strong v-if="title">{{ title }}</strong>
                <span v-if="subtitle">{{ subtitle }}</span>
              </div>
              <button v-if="closeable" class="center-dialog-close" type="button" aria-label="关闭" @click="close">
                <XIcon />
              </button>
            </header>
            <div :class="['center-dialog-body', `center-dialog-body-${variant}`]">
              <slot></slot>
            </div>
          </section>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { XIcon } from 'lucide-vue-next';

withDefaults(defineProps<{
  modelValue: boolean;
  title?: string;
  subtitle?: string;
  closeable?: boolean;
  variant?: 'default' | 'content' | 'form';
}>(), {
  closeable: true,
  variant: 'default'
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

function close() {
  emit('update:modelValue', false);
}
</script>

<style scoped>
.center-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(18px, env(safe-area-inset-top)) 18px max(18px, env(safe-area-inset-bottom));
  background: var(--app-overlay-bg);
}

.center-dialog-card {
  width: min(100%, 430px);
  max-height: min(78dvh, 680px);
  overflow: hidden;
  border: none;
  border-radius: var(--radius-sheet);
  background: var(--surface-sheet);
  box-shadow: var(--shadow-dialog);
  display: flex;
  flex-direction: column;
}

.center-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 15px 16px 8px;
}

.center-dialog-header strong {
  display: block;
  color: var(--text-color);
  font-size: var(--type-size-control);
  font-weight: var(--type-weight-semibold);
}

.center-dialog-header span {
  display: block;
  margin-top: 2px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
}

.center-dialog-close {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: var(--radius-control);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-muted);
  color: var(--text-secondary-color);
  flex-shrink: 0;
}

.center-dialog-close svg {
  width: 16px;
  height: 16px;
}

.center-dialog-body {
  min-height: 0;
  overflow-y: auto;
  padding: 8px 14px 14px;
}

.center-dialog-body-content,
.center-dialog-body-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.center-dialog-fade-enter-active,
.center-dialog-fade-leave-active,
.center-dialog-pop-enter-active,
.center-dialog-pop-leave-active {
  transition: opacity .18s ease, transform .18s ease;
}

.center-dialog-fade-enter-from,
.center-dialog-fade-leave-to {
  opacity: 0;
}

.center-dialog-pop-enter-from,
.center-dialog-pop-leave-to {
  transform: translateY(10px) scale(.98);
  opacity: 0;
}
</style>
