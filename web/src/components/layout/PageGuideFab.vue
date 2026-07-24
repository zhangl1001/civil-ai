<template>
  <button
    v-if="guide && dockExpanded && !isOpen"
    class="page-guide-collapse-zone"
    type="button"
    aria-label="收起导读入口"
    @click="closeDock"
  ></button>
  <div v-if="guide" :class="['page-guide-dock', { expanded: dockExpanded }]">
    <button
      class="page-guide-fab"
      type="button"
      :aria-label="dockExpanded ? '收起导读入口' : '展开导读入口'"
      @click.stop="toggleDock"
    >
      <BookOpenIcon />
    </button>
    <button v-if="dockExpanded" class="page-guide-open" type="button" @click.stop="openGuide">
      导读
    </button>
  </div>

  <Teleport to="body">
    <Transition name="guide-fade">
      <div v-if="guide && isOpen" class="guide-overlay">
        <button class="guide-close-zone" type="button" aria-label="关闭页面导读" @click="isOpen = false"></button>
        <Transition name="guide-scroll" appear>
          <aside class="guide-scroll-panel" role="dialog" aria-modal="false" aria-label="页面导读">
            <header class="guide-drawer-head">
              <div>
                <strong>{{ guide.title }}</strong>
                <span>{{ guide.subtitle }}</span>
              </div>
              <button class="guide-close-button" type="button" aria-label="收起页面导读" @click="isOpen = false">
                <ChevronLeftIcon />
              </button>
            </header>
            <nav class="guide-nav" aria-label="页面目录">
              <button
                v-for="(item, index) in guide.items"
                :key="item.key || item.title"
                type="button"
                class="guide-nav-item"
                @click="jumpTo(item.targetId)"
              >
                <i>{{ String(index + 1).padStart(2, '0') }}</i>
                <span>
                  <strong>{{ item.title }}</strong>
                  <em>{{ item.description }}</em>
                </span>
              </button>
            </nav>
          </aside>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { BookOpenIcon, ChevronLeftIcon } from 'lucide-vue-next';
import type { BookIndexItem } from '@/components/layout/BookIndex.vue';

interface PageGuide {
  title: string;
  subtitle: string;
  sheetSubtitle: string;
  items: BookIndexItem[];
}

const guides: Partial<Record<string, PageGuide>> = {
  Home: homeGuide(),
  VueHome: homeGuide(),
  VuePracticeCenter: {
    title: '刷题中心导读',
    subtitle: '从智能推题开始练习，也可以按模块、错题和复盘工具进入。',
    sheetSubtitle: '刷题中心的主要模块',
    items: [
      { key: 'start', title: '快速开始', description: '智能推题和申论写作', targetId: 'practice-start' },
      { key: 'tools', title: '训练工具', description: '错题、模考、积累和报告', targetId: 'practice-tools' },
      { key: 'modules', title: '专项练习', description: '按行测模块生成题组', targetId: 'practice-modules' },
      { key: 'recent', title: '近期记录', description: '回看最近 7 次训练', targetId: 'practice-recent' }
    ]
  }
};

const route = useRoute();
const isOpen = ref(false);
const dockExpanded = ref(false);
const guide = computed(() => guides[String(route.name || '')]);
let collapseTimer: number | null = null;

watch(() => route.fullPath, () => {
  clearCollapseTimer();
  isOpen.value = false;
  dockExpanded.value = false;
});

watch(dockExpanded, (expanded) => {
  clearCollapseTimer();
  if (expanded) {
    collapseTimer = window.setTimeout(() => {
      dockExpanded.value = false;
    }, 1000);
  }
});

onBeforeUnmount(() => {
  clearCollapseTimer();
});

function toggleDock() {
  dockExpanded.value = !dockExpanded.value;
}

function openGuide() {
  clearCollapseTimer();
  dockExpanded.value = false;
  isOpen.value = true;
}

function closeDock() {
  if (!dockExpanded.value) return;
  clearCollapseTimer();
  dockExpanded.value = false;
}

function clearCollapseTimer() {
  if (collapseTimer === null) return;
  window.clearTimeout(collapseTimer);
  collapseTimer = null;
}

function jumpTo(targetId?: string) {
  if (!targetId) return;
  isOpen.value = false;
  window.setTimeout(() => {
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

function homeGuide(): PageGuide {
  return {
    title: '计划中心导读',
    subtitle: '先看今日安排，再进入训练、复盘和能力提升工具。',
    sheetSubtitle: '计划中心的主要模块',
    items: [
      { key: 'today', title: '今日安排', description: '任务、倒计时和当天节奏', targetId: 'home-today' },
      { key: 'quick', title: '快捷入口', description: '刷题、精讲、申论和模考', targetId: 'home-quick' },
      { key: 'ability', title: '能力概览', description: '各模块正确率和薄弱项', targetId: 'home-ability' },
      { key: 'tools', title: '提升中心', description: '复盘、地图、冲刺工具', targetId: 'home-tools' }
    ]
  };
}
</script>

<style scoped>
.page-guide-dock {
  position: fixed;
  left: max(0px, env(safe-area-inset-left));
  bottom: calc(98px + var(--app-safe-bottom));
  z-index: 18;
  height: 34px;
  max-width: 104px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 5px 2px 2px;
  border-radius: 0 14px 14px 0;
  background: rgba(255, 255, 255, .24);
  box-shadow: 0 8px 18px rgba(28, 38, 58, .055);
  backdrop-filter: blur(14px) saturate(1.08);
  -webkit-backdrop-filter: blur(14px) saturate(1.08);
  opacity: .38;
  transform: translateX(-24px);
  transition: opacity .18s ease, transform .18s ease, background .18s ease;
}

.page-guide-collapse-zone {
  position: fixed;
  inset: 0;
  z-index: 17;
  border: 0;
  background: transparent;
}

.page-guide-dock.expanded,
.page-guide-dock:active {
  opacity: .9;
  transform: translateX(0);
  background: rgba(255, 255, 255, .7);
}

.page-guide-fab,
.page-guide-open {
  border: 1px solid rgba(255, 255, 255, .62);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
}

.page-guide-fab {
  width: 30px;
  height: 30px;
  border-radius: 11px;
  color: var(--primary-color);
  background: rgba(255, 255, 255, .58);
}

.page-guide-fab svg {
  width: 16px;
  height: 16px;
}

.page-guide-open {
  height: 30px;
  min-width: 44px;
  border-radius: 12px;
  padding: 0 10px;
  color: var(--text-color);
  background: rgba(255, 255, 255, .72);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.page-guide-fab:active,
.page-guide-open:active {
  transform: scale(.96);
}

.guide-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  pointer-events: none;
}

.guide-close-zone {
  position: absolute;
  inset: 0;
  border: 0;
  background: transparent;
  pointer-events: auto;
}

.guide-scroll-panel {
  position: absolute;
  left: max(12px, env(safe-area-inset-left));
  top: calc(108px + var(--app-safe-top));
  bottom: calc(104px + var(--app-safe-bottom));
  width: min(72vw, 286px);
  max-height: 500px;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid rgba(255, 255, 255, .68);
  border-radius: 28px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, .42) 0%, rgba(255, 255, 255, .9) 18%, rgba(255, 255, 255, .94) 50%, rgba(255, 255, 255, .9) 82%, rgba(255, 255, 255, .42) 100%),
    linear-gradient(180deg, rgba(248, 251, 255, .92), rgba(241, 246, 252, .84));
  box-shadow:
    0 18px 44px rgba(28, 38, 58, .14),
    inset 18px 0 24px rgba(255, 255, 255, .55),
    inset -18px 0 24px rgba(255, 255, 255, .48);
  backdrop-filter: blur(22px) saturate(1.18);
  -webkit-backdrop-filter: blur(22px) saturate(1.18);
  overflow: hidden;
  pointer-events: auto;
}

.guide-scroll-panel::before,
.guide-scroll-panel::after {
  content: '';
  position: absolute;
  top: 10px;
  bottom: 10px;
  width: 18px;
  border-radius: 999px;
  pointer-events: none;
}

.guide-scroll-panel::before {
  left: 5px;
  background: linear-gradient(90deg, rgba(255, 255, 255, .52), rgba(255, 255, 255, 0));
}

.guide-scroll-panel::after {
  right: 5px;
  background: linear-gradient(270deg, rgba(255, 255, 255, .52), rgba(255, 255, 255, 0));
}

.guide-drawer-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 2px 2px 0;
}

.guide-drawer-head strong,
.guide-drawer-head span {
  display: block;
}

.guide-drawer-head strong {
  color: var(--text-color);
  font-size: var(--type-size-body-large);
}

.guide-drawer-head span {
  margin-top: 2px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
  line-height: 1.35;
}

.guide-close-button {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary-color);
  background: rgba(var(--color-ink-rgb), .06);
  flex-shrink: 0;
}

.guide-close-button svg {
  width: 16px;
  height: 16px;
}

.guide-fade-enter-active,
.guide-fade-leave-active {
  transition: opacity .18s ease;
}

.guide-fade-enter-from,
.guide-fade-leave-to {
  opacity: 0;
}

.guide-nav {
  position: relative;
  z-index: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px 2px 2px 0;
  -webkit-overflow-scrolling: touch;
}

.guide-nav-item {
  width: 100%;
  min-height: 58px;
  border: 1px solid rgba(var(--color-ink-rgb), .055);
  border-radius: 999px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 9px;
  color: inherit;
  background: rgba(255, 255, 255, .56);
  font-family: inherit;
  text-align: left;
  box-shadow: 0 8px 20px rgba(28, 38, 58, .045);
}

.guide-nav-item i {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .1);
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}

.guide-nav-item span {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.guide-nav-item strong,
.guide-nav-item em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.guide-nav-item strong {
  color: var(--text-color);
  font-size: var(--type-size-secondary);
}

.guide-nav-item em {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
}

.guide-scroll-enter-active,
.guide-scroll-leave-active {
  transition: transform .22s ease, opacity .22s ease, filter .22s ease;
}

.guide-scroll-enter-from,
.guide-scroll-leave-to {
  opacity: 0;
  filter: blur(2px);
  transform: translateX(-24px) scaleX(.94);
}
</style>
