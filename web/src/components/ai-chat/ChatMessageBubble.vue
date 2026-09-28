<template>
  <article :class="['message', message.role, outcome?.status]">
    <span v-if="message.role !== 'user'" :class="['message-cat', { active: streaming }]" aria-hidden="true"><CatIcon /></span>
    <p v-if="message.role === 'user'">{{ message.content }}</p>
    <template v-else>
      <p v-if="streaming && !message.content" class="streaming-placeholder">
        <span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>思考中</span>
      </p>
      <MarkdownContent v-else-if="message.content" class="md-message" :content="message.content" variant="chat" />
      <div v-if="outcome" class="message-outcome" :role="outcome.status === 'failed' ? 'alert' : 'status'">
        <p>
          <TriangleAlertIcon v-if="outcome.status === 'failed'" aria-hidden="true" />
          <CircleStopIcon v-else aria-hidden="true" />
          <span>{{ outcome.message }}</span>
        </p>
        <div v-if="actionable" class="message-outcome-actions">
          <button v-if="outcome.configureModel" type="button" @click="emit('configure')">
            <SettingsIcon aria-hidden="true" />去配置
          </button>
          <button type="button" @click="emit('retry')">
            <RotateCcwIcon aria-hidden="true" />重试
          </button>
        </div>
      </div>
    </template>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CatIcon, CircleStopIcon, RotateCcwIcon, SettingsIcon, TriangleAlertIcon } from 'lucide-vue-next';
import MarkdownContent from '@/components/MarkdownContent.vue';
import type { AIChatMessage } from '@/services/AIChatRepository';
import { chatMessageOutcome } from './AIChatPresentation';

const props = defineProps<{
  message: AIChatMessage;
  streaming: boolean;
  /** Only the latest turn offers retry/configure, so old failures stay quiet. */
  actionable: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  configure: [];
}>();

const outcome = computed(() => props.message.role === 'assistant' ? chatMessageOutcome(props.message) : undefined);
</script>

<style scoped>
.message {
  max-width: 84%;
  padding: 10px 12px;
  border-radius: 15px;
  line-height: 1.58;
  font-size: var(--type-size-body);
  position: relative;
}

.message p {
  margin: 0;
  white-space: pre-wrap;
}

.message.user {
  align-self: flex-end;
  color: #fff;
  background: var(--primary-color);
  border-bottom-right-radius: 5px;
}

.message.assistant,
.message.tool,
.message.system {
  align-self: flex-start;
  margin-left: 30px;
  color: var(--text-color);
  background: rgba(255, 255, 255, .86);
  border: 1px solid rgba(var(--color-ink-rgb), .06);
  border-bottom-left-radius: 5px;
}

.message.failed {
  border-color: rgba(179, 38, 30, .18);
}

.message-cat {
  position: absolute;
  left: -30px;
  top: 2px;
  width: 24px;
  height: 24px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-brand-strong);
  background: rgba(var(--color-brand-rgb), .13);
}

.message-cat svg {
  width: 15px;
  height: 15px;
}

.message-cat.active {
  animation: catThinking 1.05s ease-in-out infinite;
}

.streaming-placeholder {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary-color);
}

.thinking-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.thinking-dots i {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--color-brand);
  animation: thinkingDot 1.1s ease-in-out infinite;
}

.thinking-dots i:nth-child(2) {
  animation-delay: .14s;
}

.thinking-dots i:nth-child(3) {
  animation-delay: .28s;
}

.message-outcome {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.md-message + .message-outcome {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(var(--color-ink-rgb), .07);
}

.message-outcome p {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  line-height: 1.5;
  white-space: normal;
}

.message.failed .message-outcome p {
  color: #b3261e;
}

.message-outcome p svg {
  width: 14px;
  height: 14px;
  margin-top: 2px;
  flex-shrink: 0;
}

.message-outcome-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.message-outcome-actions button {
  height: 28px;
  border: none;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 11px;
  color: var(--primary-color);
  background: rgba(var(--color-brand-rgb), .1);
  font-family: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.message-outcome-actions button svg {
  width: 13px;
  height: 13px;
}

@keyframes thinkingDot {
  0%, 60%, 100% { transform: translateY(0); opacity: .38; }
  30% { transform: translateY(-3px); opacity: 1; }
}

@keyframes catThinking {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(-2px) rotate(-4deg); }
  50% { transform: translateY(0) rotate(0deg); }
  75% { transform: translateY(-1px) rotate(4deg); }
}
</style>
