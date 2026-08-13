<template>
  <slot v-if="!error" />
  <section v-else class="view-error-boundary">
    <strong>页面暂时加载失败</strong>
    <p>{{ message }}</p>
    <button type="button" @click="retry">重新加载</button>
  </section>
</template>

<script setup lang="ts">
import { computed, onErrorCaptured, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const error = ref<unknown>();
const message = computed(() => error.value instanceof Error ? error.value.message : '请稍后重试，或返回首页重新进入。');

onErrorCaptured((cause) => {
  console.error('[view error boundary]', cause);
  error.value = cause;
  return false;
});

/**
 * The boundary used to be re-created per route through a `:key`, which also
 * discarded every cached tab root on each navigation. Clearing the failure here
 * keeps the same reset without destroying the view cache. A live failure still
 * unmounts the slot, so the broken view is rebuilt from scratch on retry.
 */
watch(() => route.fullPath, () => {
  error.value = undefined;
});

function retry() {
  error.value = undefined;
}
</script>

<style scoped>
.view-error-boundary {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  padding: 28px 18px;
  color: var(--text-color);
  text-align: center;
}

.view-error-boundary strong {
  font-size: var(--type-size-section-title);
}

.view-error-boundary p {
  margin: 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  line-height: 1.5;
}

.view-error-boundary button {
  align-self: center;
  min-height: 38px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--radius-pill);
  color: #fff;
  background: var(--primary-color);
  font: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
</style>
