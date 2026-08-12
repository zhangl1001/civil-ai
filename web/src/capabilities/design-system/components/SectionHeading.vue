<template>
  <div class="section-heading">
    <strong>{{ title }}</strong>
    <slot name="action">
      <span v-if="meta">{{ meta }}</span>
    </slot>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  /** Right-aligned caption. Use the `action` slot instead when a control belongs there. */
  meta?: string;
}>();
</script>

<style scoped>
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.section-heading strong {
  min-width: 0;
  font-size: var(--type-size-body-large);
}

.section-heading span {
  flex: 0 0 auto;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
</style>
