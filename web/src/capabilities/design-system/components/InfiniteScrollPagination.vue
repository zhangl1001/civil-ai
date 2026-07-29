<template>
  <slot />
  <div v-if="hasMore" ref="sentinel" class="infinite-scroll-sentinel" aria-hidden="true"></div>
  <p v-else-if="hasItems && showEnd" class="infinite-scroll-end">{{ endText }}</p>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  hasMore: boolean;
  hasItems: boolean;
  loading?: boolean;
  onLoadMore: () => Promise<void> | void;
  scrollRoot?: Element | null;
  showEnd?: boolean;
  rootMargin?: string;
  endText?: string;
}>(), {
  loading: false,
  showEnd: true,
  rootMargin: '180px 0px',
  endText: '已到底'
});

const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | undefined;

onMounted(() => void observe());
onBeforeUnmount(() => observer?.disconnect());
watch(() => [props.hasMore, props.loading, props.hasItems, props.scrollRoot], () => void observe());

async function observe(): Promise<void> {
  await nextTick();
  observer?.disconnect();
  if (!props.hasMore || props.loading || !sentinel.value || typeof IntersectionObserver === 'undefined') return;
  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) void props.onLoadMore();
  }, { root: props.scrollRoot ?? null, rootMargin: props.rootMargin });
  observer.observe(sentinel.value);
}
</script>

<style scoped>
.infinite-scroll-sentinel { min-height: 1px; pointer-events: none; }
.infinite-scroll-end {
  margin: 2px 0 0;
  color: color-mix(in srgb, var(--text-secondary-color) 58%, transparent);
  font-size: var(--type-size-micro);
  line-height: 1.3;
  text-align: center;
}
</style>
