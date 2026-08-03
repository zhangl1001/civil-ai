<template>
  <button class="toggle-row toggle-button" type="button" @click="enabled = !enabled">
    <span>网络研究</span>
    <i :class="['switch-control', { active: enabled }]" aria-hidden="true"></i>
  </button>
  <template v-if="enabled">
    <label>
      <span>搜索服务</span>
      <div class="option-group provider-options">
        <button
          v-for="item in providerOptions"
          :key="item.value"
          type="button"
          :class="{ active: provider === item.value }"
          @click="provider = item.value"
        >
          {{ item.label }}
        </button>
      </div>
      <small>按需调用搜索与网页读取，失败时自动切换可用来源</small>
    </label>
    <label v-if="provider !== WebSearchProvider.Auto && provider !== WebSearchProvider.SearXNG">
      <span>搜索 API Key</span>
      <input v-model="apiKey" type="password" placeholder="未填写时使用内置搜索兜底" autocomplete="off" />
    </label>
    <label v-if="provider === WebSearchProvider.SearXNG">
      <span>SearXNG 地址</span>
      <input v-model="searxngBaseUrl" placeholder="https://search.example.com" autocomplete="off" />
    </label>
    <template v-if="provider === WebSearchProvider.Auto">
      <label>
        <span>Brave Key（可选）</span>
        <input v-model="braveApiKey" type="password" placeholder="未配置时自动跳过" autocomplete="off" />
      </label>
      <label>
        <span>Jina Key（可选）</span>
        <input v-model="jinaApiKey" type="password" placeholder="用于搜索与 Reader 增额" autocomplete="off" />
      </label>
      <label>
        <span>Firecrawl Key（可选）</span>
        <input v-model="firecrawlApiKey" type="password" placeholder="用于搜索与正文抓取" autocomplete="off" />
      </label>
      <label>
        <span>SearXNG 地址（可选）</span>
        <input v-model="searxngBaseUrl" placeholder="自建实例 https://..." autocomplete="off" />
      </label>
    </template>
  </template>
</template>

<script setup lang="ts">
import {
  WebSearchProvider,
  type WebSearchProviderCode
} from '@/capabilities/web-research/public';

defineProps<{
  providerOptions: ReadonlyArray<{ value: WebSearchProviderCode; label: string }>;
}>();

const enabled = defineModel<boolean>('enabled', { required: true });
const provider = defineModel<WebSearchProviderCode>('provider', { required: true });
const apiKey = defineModel<string>('apiKey', { required: true });
const jinaApiKey = defineModel<string>('jinaApiKey', { required: true });
const braveApiKey = defineModel<string>('braveApiKey', { required: true });
const firecrawlApiKey = defineModel<string>('firecrawlApiKey', { required: true });
const searxngBaseUrl = defineModel<string>('searxngBaseUrl', { required: true });
</script>
