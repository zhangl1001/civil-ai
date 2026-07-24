<template>
  <div class="legacy-frame-page">
    <iframe
      :key="frameSrc"
      class="legacy-frame"
      :src="frameSrc"
      title="公考辅导"
    ></iframe>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const shellPages = new Set(['home', 'practice', 'exam', 'wrongbook', 'profile']);
const route = useRoute();

const frameSrc = computed(() => {
  const page = String(route.meta.legacyPage || route.params.page || 'home');
  if (shellPages.has(page)) {
    return `legacy/index.html#${page}`;
  }
  return `legacy/${page}.html`;
});
</script>

<style scoped>
.legacy-frame-page {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #f5f6fa;
}

.legacy-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #f5f6fa;
}
</style>
