<template>
  <Teleport to="body">
    <Transition name="bottom-sheet-fade">
      <div v-if="modelValue" class="bottom-sheet-overlay" @click.self="close">
        <Transition name="bottom-sheet-slide" appear>
          <section :class="['bottom-sheet-card', `bottom-sheet-${variant}`]" role="dialog" aria-modal="true" :aria-label="title || '弹出面板'">
            <header v-if="title || subtitle || closeable" class="bottom-sheet-header">
              <div>
                <strong v-if="title">{{ title }}</strong>
                <span v-if="subtitle">{{ subtitle }}</span>
              </div>
              <button v-if="closeable" class="bottom-sheet-close" type="button" aria-label="关闭" @click="close">
                <XIcon />
              </button>
            </header>
            <div :class="['bottom-sheet-body', `bottom-sheet-body-${variant}`]">
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
  variant?: 'default' | 'actions' | 'filter' | 'form';
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
.bottom-sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
  background: var(--app-overlay-bg);
}

.bottom-sheet-card {
  width: min(100%, 520px);
  max-height: min(82dvh, 680px);
  overflow: hidden;
  border: none;
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  background: var(--surface-sheet);
  box-shadow: var(--shadow-raised);
  display: flex;
  flex-direction: column;
}

.bottom-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 8px;
  border-bottom: none;
}

.bottom-sheet-header strong {
  display: block;
  color: var(--text-color);
  font-size: var(--type-size-control);
  font-weight: var(--type-weight-semibold);
  line-height: var(--type-line-title);
}

.bottom-sheet-header span {
  display: block;
  margin-top: 2px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
}

.bottom-sheet-close {
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

.bottom-sheet-close svg {
  width: 16px;
  height: 16px;
}

.bottom-sheet-body {
  overflow-y: auto;
  padding: 8px 14px calc(12px + env(safe-area-inset-bottom));
}

.bottom-sheet-body-actions,
.bottom-sheet-body-filter,
.bottom-sheet-body-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bottom-sheet-card :deep(.sheet-body),
.bottom-sheet-card :deep(.sheet-form) {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.bottom-sheet-card :deep(.form-grid),
.bottom-sheet-card :deep(.time-grid) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.bottom-sheet-actions :deep(.menu-row),
.bottom-sheet-actions :deep(.action-card) {
  width: 100%;
  min-height: 46px;
  border: none;
  border-radius: var(--radius-control);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  background: var(--surface-control);
  color: var(--text-color);
  box-shadow: none;
  font: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-medium);
  text-align: left;
}

.bottom-sheet-actions :deep(.menu-row svg),
.bottom-sheet-actions :deep(.action-card svg) {
  width: 17px;
  height: 17px;
  color: var(--primary-color);
  flex-shrink: 0;
}

.bottom-sheet-actions :deep(.menu-field),
.bottom-sheet-filter :deep(.filter-card),
.bottom-sheet-filter :deep(.form-row),
.bottom-sheet-filter :deep(.tag-panel),
.bottom-sheet-filter :deep(.essay-type),
.bottom-sheet-filter :deep(.module-sheet),
.bottom-sheet-form :deep(label),
.bottom-sheet-card :deep(.sheet-body label),
.bottom-sheet-card :deep(.sheet-form label) {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 0;
  border: none;
  border-radius: var(--radius-card);
  padding: 10px;
  background: var(--surface-card);
  box-shadow: none;
}

.bottom-sheet-card :deep(.sheet-body label span),
.bottom-sheet-card :deep(.sheet-form label span) {
  display: block;
  margin: 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-medium);
}

.bottom-sheet-card :deep(.sheet-body label small),
.bottom-sheet-card :deep(.sheet-form label small) {
  display: block;
  margin-top: 6px;
  color: var(--text-secondary-color);
  opacity: .76;
  font-size: var(--type-size-micro);
  line-height: 1.4;
}

.bottom-sheet-filter :deep(.module-sheet) {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bottom-sheet-filter :deep(.module-grid),
.bottom-sheet-filter :deep(.scheme-grid) {
  margin-top: 0;
}

.bottom-sheet-filter :deep(.count-field) {
  margin: 0;
}

.bottom-sheet-filter :deep(.tag-panel label),
.bottom-sheet-filter :deep(.form-row label),
.bottom-sheet-form :deep(label span) {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.bottom-sheet-card :deep(input),
.bottom-sheet-card :deep(textarea),
.bottom-sheet-card :deep(select) {
  border: none;
  outline: none;
  border-radius: var(--radius-control);
  min-height: 42px;
  padding: 0 11px;
  background: var(--surface-control);
  color: var(--text-color);
  font-family: inherit;
  box-shadow: none;
  -webkit-appearance: none;
  appearance: none;
}

.bottom-sheet-card :deep(input:focus),
.bottom-sheet-card :deep(textarea:focus),
.bottom-sheet-card :deep(select:focus) {
  box-shadow: inset 0 0 0 1px var(--border-focus);
}

.bottom-sheet-card :deep(textarea) {
  min-height: 78px;
  padding: 10px;
  resize: vertical;
  line-height: 1.45;
}

.bottom-sheet-card :deep(.toggle-row) {
  min-height: 54px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.bottom-sheet-card :deep(.toggle-button) {
  width: 100%;
  border: none;
  border-radius: var(--radius-card);
  padding: 10px;
  display: flex;
  background: var(--surface-card);
  color: var(--text-color);
  font: inherit;
  text-align: left;
}

.bottom-sheet-card :deep(.toggle-row > span) {
  color: var(--text-color);
  font-size: var(--type-size-body);
}

.bottom-sheet-card :deep(.switch-control) {
  position: relative;
  width: 46px;
  height: 28px;
  border-radius: 999px;
  flex: 0 0 46px;
  background: rgba(var(--color-ink-rgb), .12);
  box-shadow: inset 0 0 0 1px rgba(var(--color-ink-rgb), .04);
}

.bottom-sheet-card :deep(.switch-control::before) {
  content: '';
  position: absolute;
  left: 3px;
  top: 3px;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 2px 6px rgba(28, 38, 58, .16);
  transition: transform .18s ease;
}

.bottom-sheet-card :deep(.switch-control.active) {
  background: rgba(var(--color-brand-rgb), .72);
}

.bottom-sheet-card :deep(.switch-control.active::before) {
  transform: translateX(18px);
}

.bottom-sheet-card :deep(.switch-input) {
  width: 46px;
  height: 28px;
  min-height: 28px;
  border-radius: 999px;
  padding: 0;
  background: rgba(var(--color-ink-rgb), .12);
  box-shadow: inset 0 0 0 1px rgba(var(--color-ink-rgb), .04);
  position: relative;
}

.bottom-sheet-card :deep(.switch-input::before) {
  content: '';
  position: absolute;
  left: 3px;
  top: 3px;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 2px 6px rgba(28, 38, 58, .16);
  transition: transform .18s ease;
}

.bottom-sheet-card :deep(.switch-input:checked) {
  background: rgba(var(--color-brand-rgb), .72);
}

.bottom-sheet-card :deep(.switch-input:checked::before) {
  transform: translateX(18px);
}

.bottom-sheet-card :deep(.option-group) {
  min-height: 42px;
  padding: 3px;
  border-radius: var(--radius-control);
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 3px;
  background: var(--surface-muted);
}

.bottom-sheet-card :deep(.provider-options) {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.bottom-sheet-card :deep(.concurrency-options) {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.bottom-sheet-card :deep(.option-group button) {
  min-width: 0;
  height: 36px;
  border: none;
  border-radius: calc(var(--radius-control) - 2px);
  background: transparent;
  color: var(--text-secondary-color);
  font-family: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bottom-sheet-card :deep(.option-group button.active) {
  color: var(--primary-color);
  background: var(--surface-card-strong);
  box-shadow: var(--shadow-card);
}

.bottom-sheet-card :deep(.config-actions) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
  gap: 8px;
  margin-top: 4px;
  padding-bottom: 4px;
}

.bottom-sheet-card :deep(.config-actions button) {
  width: 100%;
  min-width: 0;
  height: 44px;
  border: none;
  border-radius: var(--radius-card);
  background: var(--primary-color);
  color: #fff;
  font-family: inherit;
  font-size: var(--type-size-body);
  font-weight: var(--type-weight-semibold);
}

.bottom-sheet-card :deep(.config-actions .ghost) {
  background: var(--surface-muted);
  color: var(--text-secondary-color);
}

.bottom-sheet-card :deep(.option-row button),
.bottom-sheet-card :deep(.count-options button),
.bottom-sheet-card :deep(.purpose-options button),
.bottom-sheet-card :deep(.module-grid button),
.bottom-sheet-card :deep(.sheet-grid button) {
  border: none;
  box-shadow: none;
}

.bottom-sheet-form :deep(label) {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 0;
}

.bottom-sheet-fade-enter-active,
.bottom-sheet-fade-leave-active {
  transition: opacity .18s ease;
}

.bottom-sheet-fade-enter-from,
.bottom-sheet-fade-leave-to {
  opacity: 0;
}

.bottom-sheet-slide-enter-active,
.bottom-sheet-slide-leave-active {
  transition: transform .2s ease, opacity .2s ease;
}

.bottom-sheet-slide-enter-from,
.bottom-sheet-slide-leave-to {
  opacity: 0;
  transform: translateY(18px);
}
</style>
