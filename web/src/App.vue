<template>
  <div class="app-container">
    <AppBackground :key="backgroundRenderKey" />
    <main :class="['main-content', { 'with-bottom-nav': showBottomNav }]">
      <router-view v-slot="{ Component }">
        <ViewErrorBoundary>
          <KeepAlive :include="CACHED_TAB_ROOTS">
            <component :is="Component" />
          </KeepAlive>
        </ViewErrorBoundary>
      </router-view>
    </main>
    <PageGuideFab />
    <TaskToast />
    <AIChatSheet />
    <nav v-if="showBottomNav" class="bottom-nav">
      <router-link to="/" class="nav-item">
        <i class="icon"><HomeIcon /></i>
        <span>首页</span>
      </router-link>
      <router-link to="/vue/practice" class="nav-item">
        <i class="icon"><Edit3Icon /></i>
        <span>刷题</span>
      </router-link>
      <router-link to="/vue/study" class="nav-item">
        <i class="icon"><BookOpenIcon /></i>
        <span>学习</span>
      </router-link>
      <router-link to="/vue/wrongbook" class="nav-item">
        <i class="icon"><BookMarkedIcon /></i>
        <span>错题本</span>
      </router-link>
      <router-link to="/vue/profile" class="nav-item">
        <i class="icon"><UserIcon /></i>
        <span>我的</span>
      </router-link>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { RouterView, RouterLink } from 'vue-router';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { HomeIcon, Edit3Icon, BookOpenIcon, BookMarkedIcon, UserIcon } from 'lucide-vue-next';
import AIChatSheet from '@/components/AIChatSheet.vue';
import AppBackground from '@/components/layout/AppBackground.vue';
import PageGuideFab from '@/components/layout/PageGuideFab.vue';
import TaskToast from '@/components/TaskToast.vue';
import ViewErrorBoundary from '@/components/layout/ViewErrorBoundary.vue';

/**
 * Tab roots stay mounted so returning to one is instant, instead of replaying
 * header, skeleton, spinner and content on every switch of the bottom nav.
 * Second-level pages are absent on purpose and keep being rebuilt per visit.
 *
 * The practice centre is also absent for now: it reads its entry mode from the
 * route query at setup time and owns a poll timer cleared on unmount, so it
 * needs activation-aware handling of its own before it can be cached.
 */
const CACHED_TAB_ROOTS = [
  'HomeView',
  'LearningCenterView',
  'TutorWrongBookView',
  'ProfileView'
];

const route = useRoute();
const showBottomNav = computed(() => route.meta.tabRoot === true);
const backgroundRenderKey = ref(0);

function refreshBackgroundLayer() {
  backgroundRenderKey.value += 1;
}

onMounted(() => {
  window.addEventListener('zhangl-webview-repaint', refreshBackgroundLayer);
});

onBeforeUnmount(() => {
  window.removeEventListener('zhangl-webview-repaint', refreshBackgroundLayer);
});
</script>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  width: 100vw;
  background: transparent;
  color: var(--text-color);
  overflow: hidden;
  position: relative;
}

.main-content {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  background: transparent;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.main-content.with-bottom-nav :deep(.page-container),
.main-content.with-bottom-nav :deep(.app-page-scroll) {
  padding-bottom: var(--app-bottom-nav-reserved);
  scroll-padding-bottom: var(--app-bottom-nav-reserved);
}

.main-content.with-bottom-nav {
  --pull-refresh-bottom-reserved: var(--app-bottom-nav-reserved);
}

.main-content.with-bottom-nav :deep(.app-page-scroll.pull-refresh) {
  padding-bottom: 0;
  scroll-padding-bottom: var(--app-bottom-nav-reserved);
}

.bottom-nav {
  position: fixed;
  left: max(12px, env(safe-area-inset-left));
  right: max(12px, env(safe-area-inset-right));
  bottom: var(--app-bottom-nav-offset);
  z-index: 8;
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 58px;
  padding: 6px;
  border: 1px solid rgba(255, 255, 255, .62);
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, .93), rgba(255, 255, 255, .8));
  box-shadow:
    0 16px 38px rgba(28, 38, 58, .14),
    inset 0 1px 0 rgba(255, 255, 255, .8);
  backdrop-filter: blur(18px) saturate(1.12);
  -webkit-backdrop-filter: blur(18px) saturate(1.12);
  flex-shrink: 0;
}

.nav-item {
  flex: 1;
  min-width: 0;
  height: 46px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  padding: 3px 4px;
  gap: 2px;
  border-radius: 999px;
  transition: color .18s ease, background .18s ease, transform .18s ease, box-shadow .18s ease;
}

.nav-item .icon,
.nav-item svg {
  width: 22px;
  height: 22px;
}

.router-link-exact-active {
  color: var(--primary-color);
  background: rgba(255, 255, 255, .86);
  box-shadow: 0 8px 20px rgba(var(--color-brand-rgb), .14);
  font-weight: var(--type-weight-semibold);
}
</style>
