<template>
  <div class="profile-page app-page">
    <PageHeader :level="1" :title="profileHeaderTitle" :meta="profileHeaderMeta" />

    <main class="profile-content page-container">
      <InitialRefreshState
        v-if="!candidateHomeLoaded"
        label="正在刷新备考档案"
      />

      <AppStateView
        v-else-if="candidateHomeError"
        compact
        state="error"
        title="备考档案暂不可用"
        :description="candidateHomeError"
        action-label="重新读取"
        @action="retryCandidateHome"
      />

      <section v-else-if="candidateHome" class="profile-section">
        <div class="profile-section-title">
          <strong>目标与现状</strong>
          <span>{{ diagnosisLabel }}</span>
        </div>
        <div class="stats-grid">
          <article v-for="score in candidateHome.scores" :key="score.subject" class="stat-card">
            <strong>{{ score.currentScore ?? '待诊断' }} → {{ score.targetScore }}</strong>
            <span>{{ subjectLabel(score.subject) }} · {{ evidenceLabel(score.evidenceLabel) }}</span>
          </article>
        </div>
      </section>

      <section v-else class="profile-section profile-onboarding">
        <strong>先建立备考档案</strong>
        <p>目标、现状和可用时间是 AI 安排教学与训练的前提。</p>
        <button type="button" @click="router.push('/vue/onboarding')">开始建档</button>
      </section>

      <section class="profile-section">
        <div class="profile-section-title">
          <strong>AI 与数据</strong>
          <span>模型、工程和本地数据</span>
        </div>
        <div class="menu-list">
          <button class="menu-item" type="button" @click="openProfileSheet">
            <TargetIcon />
            <span>备考档案</span>
            <em>{{ profileCardLabel }}</em>
            <ChevronRightIcon />
          </button>
          <button class="menu-item" type="button" @click="openAISheet">
            <CpuIcon />
            <span>AI 模型配置</span>
            <em>{{ aiCardLabel }}</em>
            <ChevronRightIcon />
          </button>
          <button class="menu-item" type="button" @click="openDataSheet">
            <DatabaseIcon />
            <span>数据管理</span>
            <em>导入导出</em>
            <ChevronRightIcon />
          </button>
          <button class="menu-item" type="button">
            <HardDriveIcon />
            <span>数据模式</span>
            <em>纯本地</em>
            <ChevronRightIcon />
          </button>
        </div>
      </section>

      <section class="profile-section">
        <div class="profile-section-title">
          <strong>系统设置</strong>
          <span>提醒和本地状态</span>
        </div>
        <div class="menu-list">
          <button class="menu-item" type="button" @click="openAppearanceSheet">
            <PaletteIcon />
            <span>外观与主题</span>
            <em>{{ appearanceLabel }}</em>
            <ChevronRightIcon />
          </button>
          <button class="menu-item" type="button" @click="openReminderSheet">
            <BellRingIcon />
            <span>学习提醒</span>
            <em>{{ reminderCardLabel }}</em>
            <ChevronRightIcon />
          </button>
          <div class="menu-item version-item" aria-label="当前版本">
            <BadgeInfoIcon />
            <span>版本信息</span>
            <em>{{ appVersionInfo.label }} · {{ appVersionInfo.buildLabel }}</em>
          </div>
        </div>
      </section>
    </main>

    <BottomSheet
      :model-value="Boolean(activeSheet)"
      :title="sheetTitle"
      :subtitle="sheetSubtitle"
      variant="form"
      @update:model-value="handleSheetVisibleChange"
    >

              <div v-if="activeSheet === 'profile'" class="sheet-body">
                <div v-if="candidateHome" class="candidate-summary">
                  <strong>{{ candidateHome.examName }}</strong>
                  <span>{{ candidateHome.examDate }} · {{ candidateHome.projectName }}</span>
                </div>
                <div v-if="candidateHome" class="time-grid">
                  <label>
                    <span>目标行测</span>
                    <input v-model.number="targetForm.aptitude" type="number" min="0" max="100" step="0.5" />
                  </label>
                  <label>
                    <span>目标申论</span>
                    <input v-model.number="targetForm.essay" type="number" min="0" max="100" step="0.5" />
                  </label>
                </div>
                <label v-if="candidateHome">
                  <span>调整原因</span>
                  <input v-model.trim="targetForm.reason" placeholder="例如：根据阶段测评调整" maxlength="120" />
                </label>
                <p v-else class="config-message">尚未建立备考档案。</p>
                <div class="config-actions">
                  <button v-if="candidateHome" type="button" @click="saveTargets" :disabled="isSavingTargets">
                    {{ isSavingTargets ? '保存中...' : '保存目标' }}
                  </button>
                  <button v-else type="button" @click="router.push('/vue/onboarding'); closeSheet()">开始建档</button>
                  <button class="ghost" type="button" @click="closeSheet">取消</button>
                </div>
                <p v-if="profileMessage" class="config-message">{{ profileMessage }}</p>
              </div>

              <div v-else-if="activeSheet === 'reminder'" class="sheet-body">
                <label>
                  <span>私教主动程度</span>
                  <div class="option-group">
                    <button
                      v-for="item in proactiveOptions"
                      :key="item.value"
                      type="button"
                      :class="{ active: proactiveLevel === item.value }"
                      @click="proactiveLevel = item.value"
                    >
                      {{ item.label }}
                    </button>
                  </div>
                </label>
                <button class="toggle-row toggle-button" type="button" @click="reminderForm.enabled = !reminderForm.enabled">
                  <span>开启每日提醒</span>
                  <i :class="['switch-control', { active: reminderForm.enabled }]" aria-hidden="true"></i>
                </button>
                <div class="time-grid">
                  <label>
                    <span>晨间计划</span>
                    <input
                      v-model="reminderForm.morningTime"
                      type="text"
                      inputmode="numeric"
                      maxlength="5"
                      placeholder="08:30"
                      @input="formatReminderTimeInput('morningTime', $event)"
                    />
                  </label>
                  <label>
                    <span>晚间复盘</span>
                    <input
                      v-model="reminderForm.eveningTime"
                      type="text"
                      inputmode="numeric"
                      maxlength="5"
                      placeholder="21:30"
                      @input="formatReminderTimeInput('eveningTime', $event)"
                    />
                  </label>
                </div>
                <div class="config-actions">
                  <button type="button" @click="saveReminders" :disabled="isSavingReminder">
                    {{ isSavingReminder ? '设置中...' : '保存提醒' }}
                  </button>
                  <button class="ghost" type="button" @click="clearReminders">关闭提醒</button>
                </div>
                <p v-if="reminderMessage" class="config-message">{{ reminderMessage }}</p>
              </div>

              <AppearanceSettings
                v-else-if="activeSheet === 'appearance'"
                @change="handleAppearanceChange"
              />

              <div v-else-if="activeSheet === 'data'" class="sheet-body">
                <div class="data-summary">
                  <strong>当前工程「{{ dataSummary?.projectName || candidateHome?.projectName || '尚未建档' }}」</strong>
                  <span>{{ dataSummary ? `备份体积约 ${dataSummary.storageText}` : '正在读取本地数据...' }}</span>
                  <div class="data-summary-grid">
                    <em>题目 {{ dataSummary?.questions || 0 }}</em>
                    <em>练习 {{ dataSummary?.sessions || 0 }}</em>
                    <em>错题 {{ dataSummary?.wrongItems || 0 }}</em>
                    <em>事件 {{ dataSummary?.events || 0 }}</em>
                  </div>
                </div>
                <button class="data-action primary" type="button" @click="exportLocalData" :disabled="isDataBusy">
                  <DownloadIcon />
                  <span>{{ dataOperation === 'export' ? '正在导出...' : '导出数据' }}</span>
                </button>
                <button class="data-action" type="button" @click="importLocalData" :disabled="isDataBusy">
                  <UploadIcon />
                  <span>{{ dataOperation === 'import' ? '正在导入...' : '导入数据' }}</span>
                </button>
                <p v-if="dataMessage" class="config-message data-message" role="status" aria-live="polite">{{ dataMessage }}</p>
                <button class="data-action danger" type="button" @click.stop="clearLearningData" :disabled="isDataBusy">
                  <Trash2Icon />
                  <span>{{ dataOperation === 'clear' ? '正在清理...' : '清除学习数据' }}</span>
                </button>
                <textarea
                  v-if="exportText"
                  class="export-text"
                  readonly
                  :value="exportText"
                  aria-label="导出备份内容"
                />
              </div>

              <div v-else class="sheet-body">
                <label>
                  <span>服务商</span>
                  <div class="option-group provider-options">
                    <button v-for="item in aiProviderOptions" :key="item.value" type="button" :class="{ active: aiForm.provider === item.value }" @click="aiForm.provider = item.value">
                      {{ item.label }}
                    </button>
                  </div>
                </label>
                <label>
                  <span>Base URL</span>
                  <input v-model="aiForm.baseUrl" placeholder="https://api.openai.com/v1" />
                </label>
                <label>
                  <span>模型</span>
                  <input v-model="aiForm.model" placeholder="gpt-4o-mini" />
                </label>
                <label>
                  <span>API Key</span>
                  <input v-model="aiForm.apiKey" type="password" placeholder="sk-..." autocomplete="off" />
                </label>
                <button class="toggle-row toggle-button" type="button" @click="aiForm.streamingEnabled = !aiForm.streamingEnabled">
                  <span>流式输出</span>
                  <i :class="['switch-control', { active: aiForm.streamingEnabled !== false }]" aria-hidden="true"></i>
                </button>
                <label>
                  <span>并发任务</span>
                  <div class="option-group concurrency-options">
                    <button
                      v-for="count in AI_TASK_CONCURRENCY_OPTIONS"
                      :key="count"
                      type="button"
                      :class="{ active: aiForm.maxConcurrentTasks === count }"
                      @click="aiForm.maxConcurrentTasks = count"
                    >
                      {{ count }}
                    </button>
                  </div>
                  <small>同时最多执行 {{ aiForm.maxConcurrentTasks }} 个 AI 任务，遇到限流会自动降速</small>
                </label>
                <WebResearchSettingsFields
                  v-model:enabled="webResearchForm.enabled"
                  v-model:provider="webResearchForm.provider"
                  v-model:api-key="webResearchForm.apiKey"
                  v-model:jina-api-key="webResearchForm.jinaApiKey"
                  v-model:brave-api-key="webResearchForm.braveApiKey"
                  v-model:firecrawl-api-key="webResearchForm.firecrawlApiKey"
                  v-model:searxng-base-url="webResearchForm.searxngBaseUrl"
                  :provider-options="webSearchProviderOptions"
                />
                <div class="config-actions">
                  <button type="button" @click="saveAIConfig" :disabled="isSavingConfig">
                    {{ isSavingConfig ? '保存中...' : '保存配置' }}
                  </button>
                  <button class="ghost" type="button" @click="testAIConfig" :disabled="isSavingConfig || isTestingConfig">
                    {{ isTestingConfig ? '测试中' : '测试' }}
                  </button>
                  <button class="ghost" type="button" @click="clearAIConfig">清空</button>
                </div>
                <p v-if="configMessage" class="config-message">{{ configMessage }}</p>
              </div>
    </BottomSheet>

    <ConfirmDialog
      v-model="showClearLearningConfirm"
      title="清除学习数据"
      description="将清除当前工程的题目、练习、错题和学习事件，保留备考计划与 AI 配置。"
      confirm-text="确认清除"
      tone="danger"
      @confirm="confirmClearLearningData"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/layout/PageHeader.vue';
import WebResearchSettingsFields from '@/components/settings/WebResearchSettingsFields.vue';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import ConfirmDialog from '@/components/layout/ConfirmDialog.vue';
import AppearanceSettings from '@/components/settings/AppearanceSettings.vue';
import { AppStateView, InitialRefreshState } from '@/capabilities/design-system/public';
import {
  BellRingIcon,
  BadgeInfoIcon,
  ChevronRightIcon,
  CpuIcon,
  DatabaseIcon,
  DownloadIcon,
  HardDriveIcon,
  PaletteIcon,
  TargetIcon,
  Trash2Icon,
  UploadIcon
} from 'lucide-vue-next';
import {
  AI_TASK_CONCURRENCY_OPTIONS,
  type AIConfig,
  type AIProviderType
} from '@/domain/ai';
import {
  WebSearchFreshness,
  WebSearchProvider,
  type WebSearchProviderCode
} from '@/capabilities/web-research/public';
import { configuredAIClient } from '@/composition-root/public';
import { aiConfigService } from '@/services/AIConfigService';
import { webResearchConfigService } from '@/services/WebResearchConfigService';
import { webResearchService } from '@/services/WebResearchService';
import { learningNotificationAdapter, type LearningNotificationStatus } from '@/platform/LearningNotificationAdapter';
import { dataManagementService, type DataSummary } from '@/services/DataManagementService';
import { THEME_PRESETS, themeService, type ThemeSettings } from '@/services/ThemeService';
import { appVersionInfo } from '@/services/AppVersionService';
import { profileStatsRepository } from '@/services/ProfileStatsRepository';
import { initializeTutorRuntime } from '@/composition-root/public';
import {
  InitialDiagnosisStatus,
  ProactiveLevel,
  type CandidateHomeSnapshot
} from '@/modules/candidate/public';
import type { SubjectCode } from '@/kernel/public';
import {
  CandidateProfileFeature,
  peekCandidateProfileSnapshot
} from '@/features/profile/CandidateProfileFeature';
const router = useRouter();
let candidateProfileFeaturePromise: Promise<CandidateProfileFeature> | undefined;
const cachedCandidateSnapshot = peekCandidateProfileSnapshot();
const isSavingConfig = ref(false);
const isTestingConfig = ref(false);
const isSavingReminder = ref(false);
const isSavingTargets = ref(false);
const isDataBusy = ref(false);
const dataOperation = ref<'export' | 'import' | 'clear' | null>(null);
const showClearLearningConfirm = ref(false);
const configMessage = ref('');
const reminderMessage = ref('');
const profileMessage = ref('');
const dataMessage = ref('');
const exportText = ref('');
const dataSummary = ref<DataSummary | null>(null);
const reminderStatus = ref<LearningNotificationStatus | null>(null);
const candidateHome = ref<CandidateHomeSnapshot | null>(cachedCandidateSnapshot?.home || null);
const candidateHomeLoaded = ref(Boolean(cachedCandidateSnapshot));
const candidateHomeError = ref('');
const profileStats = ref<Awaited<ReturnType<typeof profileStatsRepository.getStats>> | null>(null);
const activeSheet = ref<'profile' | 'reminder' | 'ai' | 'data' | 'appearance' | null>(null);
const appearanceSettings = ref<ThemeSettings>(themeService.getCurrent());
const aiProviderOptions: Array<{ value: AIProviderType; label: string }> = [
  { value: 'openai', label: 'OpenAI 兼容协议' },
  { value: 'anthropic', label: 'Anthropic 原生协议' }
];
const webSearchProviderOptions: Array<{ value: WebSearchProviderCode; label: string }> = [
  { value: WebSearchProvider.Auto, label: '智能自动' },
  { value: WebSearchProvider.Jina, label: 'Jina Search' },
  { value: WebSearchProvider.Brave, label: 'Brave Search' },
  { value: WebSearchProvider.Firecrawl, label: 'Firecrawl' },
  { value: WebSearchProvider.SearXNG, label: 'SearXNG' }
];
const aiForm = reactive<Omit<AIConfig, 'updatedAt'>>({
  provider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  streamingEnabled: true,
  maxConcurrentTasks: 3
});
const webResearchForm = reactive({
  enabled: true,
  provider: WebSearchProvider.Auto as WebSearchProviderCode,
  apiKey: '',
  jinaApiKey: '',
  braveApiKey: '',
  firecrawlApiKey: '',
  firecrawlBaseUrl: 'https://api.firecrawl.dev',
  searxngBaseUrl: ''
});
const reminderForm = reactive(learningNotificationAdapter.loadSettings());
const proactiveLevel = ref<typeof ProactiveLevel[keyof typeof ProactiveLevel]>(
  cachedCandidateSnapshot?.proactiveLevel || ProactiveLevel.Balanced
);
const proactiveOptions = [
  { value: ProactiveLevel.Quiet, label: '安静' },
  { value: ProactiveLevel.Balanced, label: '适中' },
  { value: ProactiveLevel.Active, label: '主动' }
] as const;
const targetForm = reactive({ aptitude: 80, essay: 70, reason: '' });
const secureLabel = computed(() => aiConfigService.isNativeSecure() ? 'iOS Keychain' : '本地开发存储');
const profileHeaderTitle = computed(() => candidateHome.value?.projectName || 'AI 私教档案');
const profileHeaderMeta = computed(() => {
  if (candidateHomeError.value) return '档案读取失败';
  return candidateHome.value
    ? `${candidateHome.value.examName} · ${candidateHome.value.examDate}`
    : candidateHomeLoaded.value ? '尚未建立备考档案' : '目标、进度与学习设置';
});
const aiCardLabel = computed(() => aiForm.apiKey ? `${aiForm.provider} · ${aiForm.model || '未填模型'}` : '未配置');
const reminderStatusLabel = computed(() => {
  if (!learningNotificationAdapter.isNative()) return '仅真机可用';
  if (!reminderStatus.value) return '读取中';
  const status = reminderStatus.value.authorization;
  if (status === 'authorized' || status === 'provisional') return `${reminderStatus.value.pending} 个待提醒`;
  if (status === 'denied') return '系统已拒绝';
  return '未授权';
});
const reminderCardLabel = computed(() => {
  if (!reminderForm.enabled) return '未开启';
  return `${reminderForm.morningTime} / ${reminderForm.eveningTime}`;
});
const profileCardLabel = computed(() => {
  const aptitude = candidateHome.value?.scores.find((score) => score.subject === 'aptitude');
  if (!aptitude) return '未建立';
  return `行测 ${aptitude.currentScore ?? '待诊断'}→${aptitude.targetScore}`;
});
const diagnosisLabel = computed(() => candidateHome.value?.diagnosisStatus === InitialDiagnosisStatus.Sufficient
  ? '可信基线'
  : '数据不足');
const appearanceLabel = computed(() => {
  const preset = THEME_PRESETS.find((item) => item.id === appearanceSettings.value.preset);
  return appearanceSettings.value.backgroundImage ? `${preset?.name || '主题'} · 自定义背景` : (preset?.name || '清朗蓝');
});
const sheetTitle = computed(() => {
  if (activeSheet.value === 'profile') return '备考档案';
  if (activeSheet.value === 'reminder') return '学习提醒';
  if (activeSheet.value === 'data') return '数据管理';
  if (activeSheet.value === 'appearance') return '外观与主题';
  return 'AI 配置';
});
const sheetSubtitle = computed(() => {
  if (activeSheet.value === 'profile') return '目标、现状和学习时间';
  if (activeSheet.value === 'reminder') return reminderStatusLabel.value;
  if (activeSheet.value === 'data') return '本地备份与清理';
  if (activeSheet.value === 'appearance') return '颜色、字体和个性背景';
  return secureLabel.value;
});
onMounted(() => {
  void loadCandidateHome();
  void loadAIConfig();
  void loadReminderStatus();
  void loadProfileStats();
});
async function loadProfileStats() {
  profileStats.value = await profileStatsRepository.getStats();
}
async function loadCandidateHome() {
  candidateHomeError.value = '';
  try {
    const state = await (await candidateProfileFeature()).load({ refresh: true });
    candidateHome.value = state.home;
    if (state.proactiveLevel) proactiveLevel.value = state.proactiveLevel;
    const aptitude = candidateHome.value?.scores.find((score) => score.subject === 'aptitude');
    const essay = candidateHome.value?.scores.find((score) => score.subject === 'essay');
    if (aptitude) targetForm.aptitude = aptitude.targetScore;
    if (essay) targetForm.essay = essay.targetScore;
  } catch (error) {
    candidateHomeError.value = error instanceof Error ? error.message : '读取备考档案失败';
  } finally {
    candidateHomeLoaded.value = true;
  }
}
function retryCandidateHome() {
  candidateHomeLoaded.value = false;
  void loadCandidateHome();
}
function subjectLabel(subject: SubjectCode): string {
  return subject === 'aptitude' ? '行测' : subject === 'essay' ? '申论' : subject;
}

function evidenceLabel(source: CandidateHomeSnapshot['scores'][number]['evidenceLabel']): string {
  if (source === 'measured') return '测评证据';
  if (source === 'self_report') return '自报基线';
  return '待诊断';
}
async function loadAIConfig() {
  const [config, webConfig] = await Promise.all([
    aiConfigService.load(),
    webResearchConfigService.load()
  ]);
  aiForm.provider = config.provider as AIProviderType;
  aiForm.apiKey = config.apiKey;
  aiForm.baseUrl = config.baseUrl || '';
  aiForm.model = config.model;
  aiForm.streamingEnabled = config.streamingEnabled !== false;
  aiForm.maxConcurrentTasks = config.maxConcurrentTasks;
  webResearchForm.enabled = webConfig.enabled;
  webResearchForm.provider = webConfig.provider;
  webResearchForm.apiKey = webConfig.apiKey;
  webResearchForm.jinaApiKey = webConfig.jinaApiKey || '';
  webResearchForm.braveApiKey = webConfig.braveApiKey || '';
  webResearchForm.firecrawlApiKey = webConfig.firecrawlApiKey || '';
  webResearchForm.firecrawlBaseUrl = webConfig.firecrawlBaseUrl || 'https://api.firecrawl.dev';
  webResearchForm.searxngBaseUrl = webConfig.searxngBaseUrl || '';
}

async function saveAIConfig() {
  if (isSavingConfig.value) return;
  isSavingConfig.value = true;
  configMessage.value = '';
  try {
    await Promise.all([
      aiConfigService.save({
        provider: aiForm.provider,
        apiKey: aiForm.apiKey.trim(),
        baseUrl: aiForm.baseUrl?.trim(),
        model: aiForm.model.trim(),
        streamingEnabled: aiForm.streamingEnabled !== false,
        maxConcurrentTasks: aiForm.maxConcurrentTasks
      }),
      webResearchConfigService.save({
        enabled: webResearchForm.enabled,
        provider: webResearchForm.provider,
        apiKey: webResearchForm.apiKey.trim(),
        jinaApiKey: webResearchForm.jinaApiKey.trim(),
        braveApiKey: webResearchForm.braveApiKey.trim(),
        firecrawlApiKey: webResearchForm.firecrawlApiKey.trim(),
        firecrawlBaseUrl: webResearchForm.firecrawlBaseUrl.trim(),
        searxngBaseUrl: webResearchForm.searxngBaseUrl.trim()
      })
    ]);
    configMessage.value = aiConfigService.isNativeSecure() ? '已保存到 iOS Keychain' : '已保存到本地开发存储';
  } finally {
    isSavingConfig.value = false;
  }
}

async function testAIConfig() {
  if (isTestingConfig.value) return;
  isTestingConfig.value = true;
  configMessage.value = '';
  try {
    await Promise.all([
      aiConfigService.save({
        provider: aiForm.provider,
        apiKey: aiForm.apiKey.trim(),
        baseUrl: aiForm.baseUrl?.trim(),
        model: aiForm.model.trim(),
        streamingEnabled: aiForm.streamingEnabled !== false,
        maxConcurrentTasks: aiForm.maxConcurrentTasks
      }),
      webResearchConfigService.save({
        enabled: webResearchForm.enabled,
        provider: webResearchForm.provider,
        apiKey: webResearchForm.apiKey.trim(),
        jinaApiKey: webResearchForm.jinaApiKey.trim(),
        braveApiKey: webResearchForm.braveApiKey.trim(),
        firecrawlApiKey: webResearchForm.firecrawlApiKey.trim(),
        firecrawlBaseUrl: webResearchForm.firecrawlBaseUrl.trim(),
        searxngBaseUrl: webResearchForm.searxngBaseUrl.trim()
      })
    ]);
    const result = await configuredAIClient.testConnection();
    await configuredAIClient.testStructuredOutput();
    if (webResearchForm.enabled) {
      const search = await webResearchService.search({
        query: '中国 公务员考试 时政',
        freshness: WebSearchFreshness.Month,
        limit: 1
      });
      configMessage.value = `模型与网络搜索正常：${result.slice(0, 18)} · ${search.hits.length} 条来源`;
    } else {
      configMessage.value = `连接正常：${result.slice(0, 24)}`;
    }
  } catch (error) {
    configMessage.value = error instanceof Error ? error.message : '连接测试失败';
  } finally {
    isTestingConfig.value = false;
  }
}

async function clearAIConfig() {
  await Promise.all([aiConfigService.clear(), webResearchConfigService.clear()]);
  aiForm.apiKey = '';
  webResearchForm.enabled = true;
  webResearchForm.provider = WebSearchProvider.Auto;
  webResearchForm.apiKey = '';
  webResearchForm.jinaApiKey = '';
  webResearchForm.braveApiKey = '';
  webResearchForm.firecrawlApiKey = '';
  webResearchForm.firecrawlBaseUrl = 'https://api.firecrawl.dev';
  webResearchForm.searxngBaseUrl = '';
  configMessage.value = '已清空 AI 配置';
}

function openAISheet() {
  configMessage.value = '';
  activeSheet.value = 'ai';
}

async function openProfileSheet() {
  profileMessage.value = '';
  await loadCandidateHome();
  activeSheet.value = 'profile';
}

function openReminderSheet() {
  reminderMessage.value = '';
  activeSheet.value = 'reminder';
}

function openAppearanceSheet() {
  appearanceSettings.value = themeService.getCurrent();
  activeSheet.value = 'appearance';
}

function handleAppearanceChange(settings: ThemeSettings) {
  appearanceSettings.value = settings;
}

async function openDataSheet() {
  dataMessage.value = '';
  exportText.value = '';
  activeSheet.value = 'data';
  await loadDataSummary();
}

function closeSheet() {
  activeSheet.value = null;
}

function handleSheetVisibleChange(value: boolean) {
  if (!value) closeSheet();
}

async function saveTargets() {
  if (isSavingTargets.value || !candidateHome.value) return;
  if ([targetForm.aptitude, targetForm.essay].some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    profileMessage.value = '目标分必须在 0 到 100 之间';
    return;
  }
  isSavingTargets.value = true;
  profileMessage.value = '';
  try {
    const requested = [
      { subject: 'aptitude' as SubjectCode, targetScore: targetForm.aptitude },
      { subject: 'essay' as SubjectCode, targetScore: targetForm.essay }
    ];
    const changes = requested
      .filter((change) => candidateHome.value?.scores.find((score) => score.subject === change.subject)?.targetScore !== change.targetScore)
      .map((change) => ({ ...change, maxScore: 100, reason: targetForm.reason }));
    if (!changes.length) {
      profileMessage.value = '目标没有变化';
      return;
    }
    const runtime = await initializeTutorRuntime();
    await runtime.updateScoreTargets.execute({
      idempotencyKey: `profile-targets:${candidateHome.value.examCycleId}:${crypto.randomUUID()}`,
      examCycleId: candidateHome.value.examCycleId,
      changes
    });
    await loadCandidateHome();
    targetForm.reason = '';
    profileMessage.value = '目标已更新，历史版本已保留';
  } catch (error) {
    profileMessage.value = error instanceof Error ? error.message : '目标更新失败';
  } finally {
    isSavingTargets.value = false;
  }
}

async function loadReminderStatus() {
  reminderStatus.value = await learningNotificationAdapter.status();
}

async function saveReminders() {
  if (isSavingReminder.value) return;
  isSavingReminder.value = true;
  reminderMessage.value = '';
  try {
    reminderStatus.value = await learningNotificationAdapter.save({
      enabled: reminderForm.enabled,
      morningTime: reminderForm.morningTime,
      eveningTime: reminderForm.eveningTime
    });
    await (await candidateProfileFeature()).updateReminderPreferences({
      proactiveLevel: proactiveLevel.value,
      enabled: reminderForm.enabled,
      morningTime: reminderForm.morningTime,
      eveningTime: reminderForm.eveningTime
    });
    reminderMessage.value = reminderForm.enabled
      ? (learningNotificationAdapter.isNative() ? '已设置未来 7 天学习提醒' : '已保存提醒偏好，真机运行后生效')
      : '已关闭学习提醒';
  } finally {
    isSavingReminder.value = false;
  }
}
function candidateProfileFeature(): Promise<CandidateProfileFeature> {
  candidateProfileFeaturePromise ??= initializeTutorRuntime().then((runtime) => new CandidateProfileFeature(runtime));
  return candidateProfileFeaturePromise;
}

async function clearReminders() {
  reminderForm.enabled = false;
  reminderStatus.value = await learningNotificationAdapter.clear();
  reminderMessage.value = '已关闭学习提醒';
}

function formatReminderTimeInput(field: 'morningTime' | 'eveningTime', event: Event) {
  const input = event.target as HTMLInputElement;
  const digits = input.value.replace(/\D/g, '').slice(0, 4);
  const next = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
  reminderForm[field] = next;
}

async function loadDataSummary() {
  try {
    dataSummary.value = await dataManagementService.getSummary();
  } catch (error) {
    dataMessage.value = error instanceof Error ? error.message : '数据统计读取失败';
  }
}

function downloadJson(filename: string, json: string): boolean {
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

async function exportLocalData() {
  if (isDataBusy.value) return;
  isDataBusy.value = true;
  dataOperation.value = 'export';
  dataMessage.value = '';
  try {
    const backup = await dataManagementService.exportActiveProject();
    const json = JSON.stringify(backup, null, 2);
    exportText.value = json;
    const filename = `${backup.project.name}_备份.json`;
    dataMessage.value = downloadJson(filename, json)
      ? '已生成备份文件，也可复制下方内容保存'
      : '下载不可用，请复制下方备份内容保存';
    dataSummary.value = await dataManagementService.getSummary();
  } catch (error) {
    dataMessage.value = error instanceof Error ? error.message : '导出失败';
  } finally {
    isDataBusy.value = false;
    dataOperation.value = null;
  }
}

function importLocalData() {
  if (isDataBusy.value) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    isDataBusy.value = true;
    dataOperation.value = 'import';
    dataMessage.value = '';
    try {
      const backup = JSON.parse(await file.text());
      const count = await dataManagementService.importBackup(backup);
      dataMessage.value = `导入完成：${count} 条记录`;
      await Promise.all([loadCandidateHome(), loadDataSummary()]);
    } catch (error) {
      dataMessage.value = error instanceof Error ? error.message : '导入失败';
    } finally {
      isDataBusy.value = false;
      dataOperation.value = null;
    }
  };
  input.click();
}

function clearLearningData() {
  if (isDataBusy.value) return;
  dataMessage.value = '请确认是否清除当前工程的学习数据';
  showClearLearningConfirm.value = true;
}
async function confirmClearLearningData() {
  if (isDataBusy.value) return;
  showClearLearningConfirm.value = false;
  isDataBusy.value = true;
  dataOperation.value = 'clear';
  dataMessage.value = '正在安全清理本地学习数据...';
  try {
    const count = await dataManagementService.clearLearningData();
    dataMessage.value = `已清除 ${count} 条学习数据`;
    await Promise.all([loadCandidateHome(), loadDataSummary()]);
  } catch (error) {
    dataMessage.value = error instanceof Error ? `清理失败：${error.message}` : '清理失败，请重试';
  } finally {
    isDataBusy.value = false;
    dataOperation.value = null;
  }
}
</script>

<style scoped>
.profile-content {
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.profile-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.profile-section-title {
  padding: 0 2px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}
.profile-section-title strong {
  color: var(--text-color);
  font-size: var(--type-size-control);
  font-weight: var(--type-weight-semibold);
  line-height: 1.2;
}
.profile-section-title span {
  min-width: 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.profile-onboarding {
  padding: 16px;
  border-radius: var(--radius-card);
  background: var(--surface-card);
  box-shadow: var(--app-shadow-soft);
}
.profile-onboarding > strong { font-size: var(--type-size-body-large); }
.profile-onboarding p { margin: 5px 0 13px; color: var(--text-secondary-color); font-size: var(--type-size-secondary); line-height: 1.5; }
.profile-onboarding button { min-height: 38px; border: none; border-radius: var(--radius-pill); padding: 0 15px; background: var(--primary-color); color: #fff; font: inherit; font-weight: var(--type-weight-semibold); }

.candidate-summary { padding: 12px 13px; border-radius: var(--radius-card); background: var(--surface-muted); }
.candidate-summary strong,
.candidate-summary span { display: block; }
.candidate-summary strong { font-size: var(--type-size-body); }
.candidate-summary span { margin-top: 3px; color: var(--text-secondary-color); font-size: var(--type-size-caption); }
.stat-card {
  min-height: 86px;
  padding: 14px;
  border: 0;
  border-radius: var(--radius-card);
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: var(--surface-card);
  box-shadow: var(--shadow-card);
}
.stat-card strong {
  font-size: var(--type-size-display);
  font-weight: var(--type-weight-semibold);
  color: var(--primary-color);
}
.stat-card span {
  margin-top: 4px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
}
.menu-list {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 0;
  border-radius: var(--radius-card);
  background: var(--surface-card);
  box-shadow: var(--shadow-card);
}
.menu-item {
  width: 100%;
  min-height: 52px;
  border: none;
  border-bottom: 1px solid rgba(var(--color-ink-rgb), .055);
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto 16px;
  gap: 10px;
  align-items: center;
  padding: 0 14px;
  background: transparent;
  color: var(--text-color);
  text-align: left;
  font-family: inherit;
}
.menu-item:last-child {
  border-bottom: none;
}
.menu-item svg {
  width: 17px;
  height: 17px;
  color: var(--text-secondary-color);
}
.menu-item span {
  min-width: 0;
  font-size: var(--type-size-body);
  font-weight: var(--type-weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu-item em {
  max-width: 116px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-style: normal;
  font-weight: var(--type-weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.version-item {
  cursor: default;
}
.version-item em {
  max-width: min(210px, 54vw);
}
.spin {
  animation: spin .8s linear infinite;
}
.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.section-title strong {
  font-size: var(--type-size-body-large);
}
.section-title span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.data-summary {
  padding: 14px;
  border: 0;
  border-radius: var(--radius-card);
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--surface-card);
  box-shadow: var(--shadow-card);
}
.data-summary strong {
  color: var(--text-color);
  font-size: var(--type-size-body-large);
  font-weight: var(--type-weight-semibold);
}
.data-summary span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-medium);
}
.data-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-top: 4px;
}
.data-summary-grid em {
  min-width: 0;
  border-radius: 999px;
  padding: 5px 6px;
  background: rgba(var(--color-brand-rgb), .08);
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-style: normal;
  font-weight: var(--type-weight-semibold);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.data-action {
  width: 100%;
  min-height: 46px;
  border: 1px solid rgba(var(--color-ink-rgb), .08);
  border-radius: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  background: rgba(255, 255, 255, .74);
  color: var(--text-color);
  font-family: inherit;
  font-size: var(--type-size-body);
  font-weight: var(--type-weight-semibold);
  text-align: center;
}
.data-action svg {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
}
.data-action.primary {
  border-color: transparent;
  background: var(--primary-color);
  color: #fff;
}
.data-action.danger {
  border-color: rgba(229, 57, 53, .22);
  color: #d93025;
  background: rgba(229, 57, 53, .06);
}
.data-action:disabled {
  opacity: .5;
}
.export-text {
  width: 100%;
  min-height: 180px;
  border: 1px solid rgba(var(--color-ink-rgb), .08);
  border-radius: 13px;
  padding: 10px;
  background: rgba(245, 246, 250, .86);
  color: var(--text-secondary-color);
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: var(--type-size-micro);
  line-height: 1.45;
  resize: vertical;
}
.config-message {
  margin: 10px 0 0;
  color: var(--primary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
