<template>
  <section class="app-state-view" :class="[`is-${state}`, { compact }]">
    <slot name="icon">
      <component :is="iconComponent" class="state-icon" :class="{ spinning: state === 'loading' }" />
    </slot>
    <strong>{{ titleText }}</strong>
    <p v-if="description">{{ description }}</p>
    <button v-if="actionLabel" type="button" class="state-action" @click="$emit('action')">
      {{ actionLabel }}
    </button>
    <slot name="actions" />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CheckCircle2Icon, InboxIcon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-vue-next';

const props = withDefaults(defineProps<{
  state?: 'loading' | 'empty' | 'error' | 'success';
  title?: string;
  description?: string;
  actionLabel?: string;
  compact?: boolean;
}>(), {
  state: 'empty',
  title: '',
  description: '',
  actionLabel: '',
  compact: false
});

defineEmits<{
  action: [];
}>();

const titleText = computed(() => {
  if (props.title) return props.title;
  return {
    loading: '加载中',
    empty: '暂无数据',
    error: '暂不可用',
    success: '已完成'
  }[props.state];
});

const iconComponent = computed(() => {
  return {
    loading: LoaderCircleIcon,
    empty: InboxIcon,
    error: TriangleAlertIcon,
    success: CheckCircle2Icon
  }[props.state];
});
</script>

<style scoped>
.app-state-view {
  flex: 1;
  min-height: 220px;
  padding: 24px var(--page-x);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: var(--text-secondary-color);
  text-align: center;
  background: transparent;
}

.app-state-view.compact {
  min-height: 96px;
  padding: 14px;
}

.state-icon {
  width: 34px;
  height: 34px;
  color: var(--primary-color);
}

.app-state-view.is-error .state-icon {
  color: var(--red-color);
}

.app-state-view.is-success .state-icon {
  color: var(--green-color);
}

.state-icon.spinning {
  animation: app-state-spin .9s linear infinite;
}

.app-state-view strong {
  color: var(--text-color);
  font-size: var(--type-size-control);
  font-weight: var(--type-weight-semibold);
}

.app-state-view p {
  max-width: 280px;
  margin: 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  line-height: var(--type-line-body);
}

.state-action {
  min-height: 36px;
  margin-top: 2px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  color: #fff;
  background: var(--primary-color);
  font: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}

@keyframes app-state-spin {
  to { transform: rotate(360deg); }
}
</style>
