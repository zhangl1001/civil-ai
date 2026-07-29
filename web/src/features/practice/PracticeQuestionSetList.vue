<template>
  <div ref="viewport" class="set-list-viewport">
    <InfiniteScrollPagination
      :has-more="hasMore"
      :has-items="Boolean(sets.length)"
      :loading="loading"
      :on-load-more="onLoadMore"
      :scroll-root="viewport"
      :show-end="false"
      root-margin="120px 0px"
    >
      <div class="set-list">
        <button v-for="set in sets" :key="set.id" type="button" @click="$emit('open', set)">
          <i>{{ moduleShort(set.module) }}</i>
          <span>
            <strong>{{ setTitle(set) }}</strong>
            <em>
              <b :class="`status-${set.practiceStatus}`">
                <CircleCheckIcon v-if="set.practiceStatus === QuestionSetPracticeStatus.Completed" />
                <Clock3Icon v-else-if="set.practiceStatus === QuestionSetPracticeStatus.InProgress" />
                <CircleIcon v-else />
                {{ questionSetPracticeStatusLabel(set.practiceStatus) }}
              </b>
              <span>{{ setMeta(set) }}</span>
            </em>
          </span>
          <ChevronRightIcon />
        </button>
      </div>
    </InfiniteScrollPagination>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { ChevronRightIcon, CircleCheckIcon, CircleIcon, Clock3Icon } from 'lucide-vue-next';
import { InfiniteScrollPagination } from '@/capabilities/design-system/public';
import { practiceModuleLabel } from '@/domain/labels';
import {
  QuestionSetPracticeStatus,
  questionOriginLabel,
  questionSetLibraryTitle,
  questionSetPracticeStatusLabel,
  type QuestionSetLibraryEntry
} from '@/modules/content/public';
import type { PracticeCenterMode } from './usePracticeQuestionSetPagination';

const props = defineProps<{
  mode: PracticeCenterMode;
  sets: readonly QuestionSetLibraryEntry[];
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => Promise<void> | void;
}>();

defineEmits<{ open: [set: QuestionSetLibraryEntry] }>();

const viewport = ref<HTMLElement | null>(null);
watch(() => [props.mode, props.sets[0]?.id], () => viewport.value?.scrollTo({ top: 0 }));

function setTitle(set: QuestionSetLibraryEntry): string {
  return props.mode === 'true' ? questionSetLibraryTitle(set) : `${practiceModuleLabel(set.module)} · ${set.questionCount}题`;
}

function setMeta(set: QuestionSetLibraryEntry): string {
  const details = props.mode === 'true'
    ? [questionOriginLabel(set.originType), practiceModuleLabel(set.module), `${set.questionCount}题`]
    : [roleLabel(set.assessmentRole)];
  return [...details, formatCreatedAt(set.createdAt)].join(' · ');
}

function moduleShort(module: string): string {
  return practiceModuleLabel(module).slice(0, 1);
}

function roleLabel(role: string): string {
  return ({ teaching: '讲解', guided: '引导练习', practice: '独立练习', retention: '保持复习', transfer: '迁移测试', anchor: '锚定测试' } as Record<string, string>)[role] ?? role;
}

function formatCreatedAt(value: number): string {
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
</script>

<style scoped>
.set-list-viewport { max-height:clamp(238px,42dvh,390px); overflow-y:auto; overscroll-behavior:contain; border-radius:var(--radius-card); background:rgba(var(--color-surface-rgb),.56); box-shadow:var(--shadow-card); scrollbar-width:none; -webkit-overflow-scrolling:touch; }
.set-list-viewport::-webkit-scrollbar { display:none; }
.set-list { overflow:hidden; background:transparent; }
.set-list button { width:100%; min-height:66px; border:0; border-top:1px solid rgba(var(--color-ink-rgb),.055); padding:10px 12px; display:flex; align-items:center; gap:10px; color:inherit; background:transparent; text-align:left; font:inherit; }
.set-list button:first-child { border-top:0; }
.set-list button>i { width:34px; height:34px; display:grid; place-items:center; flex:0 0 auto; border-radius:11px; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.1); font-size:var(--type-size-caption); font-style:normal; font-weight:var(--type-weight-semibold); }
.set-list button>span { min-width:0; flex:1; }
.set-list strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--type-size-secondary); }
.set-list em { margin-top:4px; display:flex; align-items:center; gap:7px; overflow:hidden; color:var(--text-secondary-color); font-size:var(--type-size-caption); font-style:normal; }
.set-list em>span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.set-list em>b { flex:0 0 auto; display:inline-flex; align-items:center; gap:3px; color:var(--text-secondary-color); font-size:inherit; font-weight:var(--type-weight-medium); }
.set-list em>b svg { width:12px; height:12px; }
.set-list em>b.status-in_progress { color:var(--orange-color); }
.set-list em>b.status-completed { color:var(--green-color); }
.set-list button>svg { width:16px; height:16px; color:var(--text-secondary-color); }
</style>
