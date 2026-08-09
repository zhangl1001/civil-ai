<template>
  <Teleport to="body">
    <Transition name="confirm-fade">
      <div v-if="modelValue" class="confirm-overlay" @click.self="close">
        <Transition name="confirm-pop" appear>
          <section class="confirm-dialog" role="dialog" aria-modal="true" :aria-label="title">
            <div :class="['confirm-icon', tone]">
              <AlertTriangleIcon v-if="tone === 'danger'" />
              <InfoIcon v-else />
            </div>
            <div class="confirm-copy">
              <strong>{{ title }}</strong>
              <p v-if="description">{{ description }}</p>
            </div>
            <div class="confirm-actions">
              <button class="confirm-cancel" type="button" @click="close">{{ cancelText }}</button>
              <button :class="['confirm-primary', tone]" type="button" @click="confirm">{{ confirmText }}</button>
            </div>
          </section>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { AlertTriangleIcon, InfoIcon } from 'lucide-vue-next';

withDefaults(defineProps<{
  modelValue: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'default' | 'danger';
}>(), {
  confirmText: '确认',
  cancelText: '取消',
  tone: 'default'
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirm: [];
}>();

function close() {
  emit('update:modelValue', false);
}

function confirm() {
  emit('confirm');
}
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--surface-overlay);
}

.confirm-dialog {
  width: min(100%, 320px);
  border-radius: var(--radius-sheet);
  padding: 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  background: var(--surface-sheet);
  box-shadow: var(--shadow-dialog);
  text-align: center;
}

.confirm-icon {
  width: 42px;
  height: 42px;
  border-radius: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .1);
}

.confirm-icon.danger {
  color: var(--red-color);
  background: rgba(255, 59, 48, .1);
}

.confirm-icon svg {
  width: 21px;
  height: 21px;
}

.confirm-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.confirm-copy strong {
  color: var(--text-color);
  font-size: var(--type-size-section-title);
  line-height: 1.25;
  font-weight: var(--type-weight-semibold);
}

.confirm-copy p {
  margin: 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  line-height: 1.55;
}

.confirm-actions {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 2px;
}

.confirm-actions button {
  min-height: 42px;
  border: none;
  border-radius: var(--radius-card);
  font: inherit;
  font-size: var(--type-size-body);
  font-weight: var(--type-weight-semibold);
}

.confirm-cancel {
  color: var(--text-secondary-color);
  background: var(--surface-muted);
}

.confirm-primary {
  color: #fff;
  background: var(--primary-color);
}

.confirm-primary.danger {
  background: var(--red-color);
}

.confirm-fade-enter-active,
.confirm-fade-leave-active,
.confirm-pop-enter-active,
.confirm-pop-leave-active {
  transition: opacity .18s ease, transform .18s ease;
}

.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}

.confirm-pop-enter-from,
.confirm-pop-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(.98);
}
</style>
