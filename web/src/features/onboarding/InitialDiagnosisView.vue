<template>
  <div class="diagnosis-page app-page">
    <PageHeader title="初始诊断" meta="用少量锚定题建立可信起点" :level="2" />

    <main class="diagnosis-content">
      <section class="diagnosis-intro">
        <span class="intro-icon"><ScanSearchIcon /></span>
        <div>
          <h1>{{ statusTitle }}</h1>
          <p>{{ statusDetail }}</p>
        </div>
      </section>

      <section class="diagnosis-flow" aria-label="诊断流程">
        <div v-for="(item, index) in flow" :key="item.title" class="flow-item">
          <span>{{ index + 1 }}</span>
          <div>
            <strong>{{ item.title }}</strong>
            <p>{{ item.detail }}</p>
          </div>
        </div>
      </section>

      <section class="diagnosis-note">
        <ShieldCheckIcon />
        <p>自报成绩只用于确定起点。达到最低可信度前，系统只显示“数据不足”，不会生成虚假的精确掌握率。</p>
      </section>
      <p v-if="error" class="diagnosis-error">{{ error }}</p>
    </main>

    <StickyActionBar>
      <button type="button" @click="router.replace('/')">稍后进行</button>
      <button class="primary" type="button" :disabled="isStarting" @click="startDiagnosis">
        {{ primaryActionLabel }}
      </button>
    </StickyActionBar>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ScanSearchIcon, ShieldCheckIcon } from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
import { StickyActionBar } from '@/capabilities/design-system/public';
import { initializeTutorRuntime } from '@/composition-root/public';
import {
  InitialDiagnosisStatus,
  type InitialDiagnosisStatusCode
} from '@/modules/candidate/public';
import { QuestionSetEntryMode } from '@/modules/content/public';
import { InitialDiagnosisFeature } from './InitialDiagnosisFeature';

const router = useRouter();
const status = ref<InitialDiagnosisStatusCode>(InitialDiagnosisStatus.NotStarted);
const isStarting = ref(false);
const error = ref('');

const flow = [
  { title: '模块锚定', detail: '少量覆盖面广的题，先判断行测与申论的能力区间。' },
  { title: '动态下钻', detail: '优先选择信息增益高的题，定位到具体知识点和前置缺口。' },
  { title: '冲突确认', detail: '当自评与作答证据冲突时，用确认题判断，不让 AI 凭感觉裁决。' },
  { title: '形成短期计划', detail: '达到最低可信度后立即开始训练，后续证据持续校准。' }
] as const;

const statusTitle = computed(() => status.value === InitialDiagnosisStatus.Sufficient
  ? '可信能力基线已经建立'
  : '还需要真实作答证据');

const statusDetail = computed(() => status.value === InitialDiagnosisStatus.Sufficient
  ? '后续训练会持续校准能力判断和目标分差。'
  : '当前成绩主要来自建档自报，不能直接当作长期能力画像。');

const primaryActionLabel = computed(() => {
  if (isStarting.value) return '正在准备诊断...';
  if (status.value === InitialDiagnosisStatus.Sufficient) return '查看能力画像';
  if (status.value === InitialDiagnosisStatus.InProgress) return '继续诊断';
  return '开始诊断';
});

onMounted(async () => {
  const runtime = await initializeTutorRuntime();
  const snapshot = await runtime.getCandidateHome.execute();
  if (!snapshot) {
    await router.replace('/vue/onboarding');
    return;
  }
  status.value = snapshot.diagnosisStatus;
});

async function startDiagnosis() {
  if (isStarting.value) return;
  if (status.value === InitialDiagnosisStatus.Sufficient) {
    await router.replace('/');
    return;
  }
  isStarting.value = true;
  error.value = '';
  try {
    const runtime = await initializeTutorRuntime();
    const result = await new InitialDiagnosisFeature(runtime).start();
    if (!result) {
      await router.replace('/vue/onboarding');
      return;
    }
    await router.push({
      path: '/vue/practice/session',
      query: {
        mode: QuestionSetEntryMode.Tutor,
        diagnosis: '1',
        scopeKey: result.scopeKey,
        capabilityNodeId: result.capabilityNodeId
      }
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '诊断任务启动失败';
  } finally {
    isStarting.value = false;
  }
}
</script>

<style scoped>
.diagnosis-page { height: 100%; min-height: 0; }
.diagnosis-content { flex: 1; min-height: 0; overflow-y: auto; padding: 16px var(--page-x) 26px; }
.diagnosis-intro,
.diagnosis-flow,
.diagnosis-note { width: min(100%, 560px); margin-inline: auto; }
.diagnosis-intro { display: flex; align-items: flex-start; gap: 12px; }
.intro-icon { width: 42px; height: 42px; border-radius: 13px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; background: rgba(var(--color-brand-rgb), .1); color: var(--primary-color); }
.intro-icon svg { width: 22px; height: 22px; }
.diagnosis-intro h1 { margin: 1px 0 0; font-size: var(--type-size-section-title); font-weight: var(--type-weight-semibold); }
.diagnosis-intro p,
.flow-item p,
.diagnosis-note p { margin: 4px 0 0; color: var(--text-secondary-color); font-size: var(--type-size-secondary); line-height: 1.55; }
.diagnosis-flow { margin-top: 22px; padding: 4px 14px; border-radius: var(--radius-card); background: var(--surface-card); box-shadow: var(--app-shadow-soft); }
.flow-item { min-height: 74px; display: flex; align-items: flex-start; gap: 12px; padding: 14px 0; }
.flow-item + .flow-item { border-top: 1px solid rgba(var(--color-ink-rgb), .055); }
.flow-item > span { width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; background: rgba(var(--color-brand-rgb), .08); color: var(--primary-color); font-size: var(--type-size-micro); font-weight: var(--type-weight-semibold); }
.flow-item strong { font-size: var(--type-size-body); font-weight: var(--type-weight-semibold); }
.diagnosis-note { margin-top: 14px; display: flex; align-items: flex-start; gap: 9px; padding: 12px 14px; border-radius: var(--radius-card); background: var(--surface-muted); }
.diagnosis-note svg { width: 18px; height: 18px; margin-top: 3px; flex-shrink: 0; color: var(--color-success); }
.diagnosis-note p { margin: 0; }
.diagnosis-error { width:min(100%,560px); margin:12px auto 0; color:var(--red-color); font-size:var(--type-size-caption); text-align:center; }
</style>
