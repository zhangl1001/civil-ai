<template>
  <span
    :class="['process-status-light', status]"
    role="status"
    :aria-label="label"
    :title="label"
  ></span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

type ProcessStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

const props = defineProps<{ status: ProcessStatus }>();
const label = computed(() => ({
  queued: '等待执行',
  running: '执行中',
  done: '已完成',
  failed: '执行失败',
  cancelled: '已取消'
})[props.status]);
</script>

<style scoped>
.process-status-light {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: rgba(var(--color-ink-rgb), .26);
  box-shadow: 0 0 0 3px rgba(var(--color-ink-rgb), .045);
}

.process-status-light.running {
  background: #d99016;
  box-shadow: 0 0 0 3px rgba(217, 144, 22, .13);
  animation: processLightPulse 1s ease-in-out infinite;
}

.process-status-light.done {
  background: var(--green-color);
  box-shadow: 0 0 0 3px rgba(34, 153, 84, .11);
}

.process-status-light.failed {
  background: var(--red-color);
  box-shadow: 0 0 0 3px rgba(210, 58, 48, .11);
}

.process-status-light.cancelled {
  background: rgba(var(--color-ink-rgb), .22);
}

@keyframes processLightPulse {
  0%, 100% { opacity: .5; transform: scale(.86); }
  50% { opacity: 1; transform: scale(1.08); }
}
</style>
