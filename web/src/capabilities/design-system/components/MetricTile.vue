<template>
  <SurfaceCard as="article" class="metric-tile" :class="`metric-tile-${variant}`" compact>
    <strong>{{ value }}</strong>
    <span>{{ label }}</span>
  </SurfaceCard>
</template>

<script setup lang="ts">
import SurfaceCard from './SurfaceCard.vue';

withDefaults(defineProps<{
  value: string | number;
  label: string;
  /**
   * `number` renders the metric type scale; `text` steps down for word values such as
   * a module name, which would otherwise outweigh the numeric tiles beside it.
   */
  variant?: 'number' | 'text';
}>(), {
  variant: 'number'
});
</script>

<style scoped>
.metric-tile {
  min-height: 76px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.metric-tile strong,
.metric-tile span {
  display: block;
}

.metric-tile strong {
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}

.metric-tile-number strong {
  font-size: var(--type-size-page-title);
}

.metric-tile-text strong {
  overflow: hidden;
  font-size: var(--type-size-section-title);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-tile span {
  margin-top: 5px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
</style>
