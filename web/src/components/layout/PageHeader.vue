<template>
  <header :class="['page-header', { 'page-header-compact': headerLevel >= 2 }]">
    <div v-if="hasHeaderRow" class="page-header-row">
      <div v-if="showBack || $slots.leading" class="page-header-leading">
        <slot name="leading"></slot>
        <button v-if="showBack && !$slots.leading" class="icon-button" type="button" @click="goBack">
          <ChevronLeftIcon />
        </button>
      </div>
      <div class="page-header-main">
        <slot v-if="$slots.title" name="title"></slot>
        <template v-else>
          <div class="page-header-title-line">
            <span v-if="displayIcon" class="page-header-route-icon">
              <component :is="displayIcon" />
            </span>
            <div class="page-header-title-copy">
              <h3>{{ displayTitle }}</h3>
              <slot name="meta">
                <span v-if="displayMeta">{{ displayMeta }}</span>
              </slot>
            </div>
          </div>
        </template>
      </div>
      <div class="page-header-actions">
        <TaskDock inline />
        <slot name="actions"></slot>
      </div>
    </div>
    <slot></slot>
  </header>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  BookMarkedIcon,
  BookOpenIcon,
  ChevronLeftIcon,
  GraduationCapIcon,
  PencilLineIcon,
  UserIcon
} from 'lucide-vue-next';
import { goBackOrHome } from '@/router/navigation';
import TaskDock from '@/components/TaskDock.vue';
import { PageHeaderIcon, type PageHeaderIcon as PageHeaderIconCode } from './PageHeaderCodes';

const props = defineProps<{
  title?: string;
  meta?: string;
  level?: number;
}>();

const route = useRoute();
const router = useRouter();
const headerLevel = computed(() => props.level ?? Number(route.meta.level || 1));
const showBack = computed(() => headerLevel.value >= 2);
const displayTitle = computed(() => props.title || (typeof route.meta.title === 'string' ? route.meta.title : ''));
const displayMeta = computed(() => props.meta || (typeof route.meta.subtitle === 'string' ? route.meta.subtitle : ''));
const headerIcons: Readonly<Record<PageHeaderIconCode, Component>> = {
  [PageHeaderIcon.Home]: GraduationCapIcon,
  [PageHeaderIcon.Practice]: PencilLineIcon,
  [PageHeaderIcon.Study]: BookOpenIcon,
  [PageHeaderIcon.WrongBook]: BookMarkedIcon,
  [PageHeaderIcon.Profile]: UserIcon
};
const displayIcon = computed(() => {
  const code = route.meta.headerIcon;
  return typeof code === 'string' && code in headerIcons
    ? headerIcons[code as PageHeaderIconCode]
    : undefined;
});
const hasHeaderRow = computed(() => Boolean(showBack.value || displayTitle.value || displayMeta.value));

function goBack() {
  goBackOrHome(router);
}
</script>

<style scoped>
.page-header {
  position: sticky;
  top: 0;
  z-index: 3;
  padding: calc(8px + var(--app-safe-top)) var(--page-x) 8px;
  background: var(--surface-header);
  box-shadow: 0 4px 14px rgba(var(--color-ink-rgb), .018);
  backdrop-filter: blur(14px) saturate(1.05);
  -webkit-backdrop-filter: blur(14px) saturate(1.05);
}

.page-header::after {
  content: '';
  position: absolute;
  inset: 100% 0 auto;
  height: 14px;
  pointer-events: none;
  background: var(--surface-header-edge);
}

.page-header-compact {
  padding-top: calc(4px + var(--app-safe-top));
  padding-bottom: 5px;
}

.page-header-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  min-width: 0;
}

.page-header-compact .page-header-row {
  min-height: 32px;
}

.page-header-compact .page-header-leading,
.page-header-compact .page-header-actions {
  min-height: 30px;
}

.page-header-compact .page-header-main h3 {
  font-size: var(--type-size-body-large);
}

.page-header-compact .page-header-title-copy > span {
  font-size: var(--type-size-micro);
}

.page-header-leading,
.page-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  flex-shrink: 0;
}

.page-header-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.page-header-title-line {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.page-header-title-copy {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.page-header-route-icon {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border-radius: 12px;
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .1);
}

.page-header-route-icon :deep(svg) {
  width: 19px;
  height: 19px;
  color: inherit;
  stroke: currentColor;
  stroke-width: 1.9;
}

.page-header-main h3 {
  margin: 0;
  color: var(--text-color);
  font-size: var(--type-size-section-title);
  font-weight: var(--type-weight-semibold);
  line-height: var(--type-line-title);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page-header-title-copy > span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
  line-height: var(--type-line-title);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
