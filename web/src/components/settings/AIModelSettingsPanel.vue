<template>
  <div class="sheet-body">
    <div class="sheet-field" role="group" :aria-labelledby="`${fieldId}-provider`">
      <span :id="`${fieldId}-provider`">服务商</span>
      <div class="option-group provider-options">
        <button v-for="item in AI_PROVIDER_OPTIONS" :key="item.value" type="button" :class="{ active: form.provider === item.value }" @click="settings.selectProvider(item.value)">
          {{ item.label }}
        </button>
      </div>
    </div>
    <label>
      <span>Base URL</span>
      <input v-model="form.baseUrl" :placeholder="providerDefaults.baseUrl" />
    </label>
    <label>
      <span>模型</span>
      <input v-model="form.model" :placeholder="providerDefaults.model" />
    </label>
    <label>
      <span>API Key</span>
      <input v-model="form.apiKey" type="password" placeholder="sk-..." autocomplete="off" />
    </label>
    <button class="toggle-row toggle-button" type="button" @click="form.streamingEnabled = !form.streamingEnabled">
      <span>流式输出</span>
      <i :class="['switch-control', { active: form.streamingEnabled !== false }]" aria-hidden="true"></i>
    </button>
    <div class="sheet-field" role="group" :aria-labelledby="`${fieldId}-concurrency`">
      <span :id="`${fieldId}-concurrency`">并发任务</span>
      <div class="option-group concurrency-options">
        <button
          v-for="count in AI_TASK_CONCURRENCY_OPTIONS"
          :key="count"
          type="button"
          :class="{ active: form.maxConcurrentTasks === count }"
          @click="form.maxConcurrentTasks = count"
        >
          {{ count }}
        </button>
      </div>
      <small>同时最多执行 {{ form.maxConcurrentTasks }} 个 AI 任务，遇到限流会自动降速</small>
    </div>
    <WebResearchSettingsFields
      v-model:enabled="webResearch.enabled"
      v-model:provider="webResearch.provider"
      v-model:api-key="webResearch.apiKey"
      v-model:jina-api-key="webResearch.jinaApiKey"
      v-model:brave-api-key="webResearch.braveApiKey"
      v-model:firecrawl-api-key="webResearch.firecrawlApiKey"
      v-model:searxng-base-url="webResearch.searxngBaseUrl"
      :provider-options="WEB_SEARCH_PROVIDER_OPTIONS"
    />
    <div class="config-actions">
      <button type="button" @click="settings.save" :disabled="status.saving">
        {{ status.saving ? '保存中...' : '保存配置' }}
      </button>
      <button class="ghost" type="button" @click="settings.test" :disabled="status.saving || status.testing">
        {{ status.testing ? '测试中' : '测试' }}
      </button>
      <button class="ghost" type="button" @click="settings.clear">清空</button>
    </div>
    <p v-if="status.message" class="config-message">{{ status.message }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';
import { AI_TASK_CONCURRENCY_OPTIONS } from '@/domain/ai';
import { AI_PROVIDER_DEFAULTS } from '@/services/AIConfigService';
import WebResearchSettingsFields from './WebResearchSettingsFields.vue';
import { AI_PROVIDER_OPTIONS, WEB_SEARCH_PROVIDER_OPTIONS, type AIModelSettings } from './useAIModelSettings';

const props = defineProps<{ settings: AIModelSettings }>();
const fieldId = useId();
// The caller owns this reactive state; the sheet edits it in place.
const { form, webResearch, status } = props.settings;
const providerDefaults = computed(() => AI_PROVIDER_DEFAULTS[form.provider]);
</script>

<style scoped>
.config-message {
  margin: 10px 0 0;
  color: var(--primary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
</style>
