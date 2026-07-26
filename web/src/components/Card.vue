<template>
  <div class="card">
    <div v-if="title" class="card-header">
      <h2 class="card-title">{{ title }}</h2>
      <div class="card-meta">
        <slot name="meta" />
      </div>
    </div>
    <div class="card-content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string;
}>();
</script>

<style scoped>
.card {
  background: var(--surface-card);
  border: 0;
  border-radius: var(--radius-card);
  padding: 14px;
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(16px) saturate(1.08);
  -webkit-backdrop-filter: blur(16px) saturate(1.08);
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.card-title {
  font-size: var(--type-size-body-large);
  font-weight: var(--type-weight-semibold);
  line-height: var(--type-line-title);
  margin: 0;
}
.card-meta {
  font-size: var(--type-size-micro);
  color: var(--color-text-secondary);
}
.card-content {
}
</style>
