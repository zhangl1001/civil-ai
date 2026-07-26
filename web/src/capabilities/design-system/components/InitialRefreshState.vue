<template>
  <div :class="['initial-refresh-state', { compact }]" :aria-label="label" role="status">
    <RefreshCwIcon />
  </div>
</template>

<script setup lang="ts">
import { RefreshCwIcon } from 'lucide-vue-next';

withDefaults(defineProps<{
  readonly label?: string;
  readonly compact?: boolean;
}>(), {
  label: '正在刷新页面数据',
  compact: false
});
</script>

<style scoped>
.initial-refresh-state {
  min-height: 110px;
  display: grid;
  place-items: center;
  color: var(--text-secondary-color);
  opacity: .38;
}
.initial-refresh-state.compact {
  min-height: 72px;
}
.initial-refresh-state svg {
  width: 16px;
  height: 16px;
  animation: spin 1.2s linear infinite;
}
</style>
