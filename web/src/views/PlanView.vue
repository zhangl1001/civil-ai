<template>
  <div class="plan-page app-page">
    <PageHeader title="备考计划" :meta="store.dashboard?.projectName || '公考练习'">
      <template #actions>
        <button class="new-plan-btn" type="button" @click="openCreateSheet">
          <PlusIcon />
          新建
        </button>
      </template>
    </PageHeader>

    <main class="app-page-scroll plan-content">
      <section v-if="store.dashboard?.countdown" class="countdown-card app-card">
        <div class="cd-days">
          <strong>{{ store.dashboard.countdown.days }}</strong>
          <span>距考试</span>
        </div>
        <div class="cd-main">
          <strong>{{ store.dashboard.countdown.phase }} · 进度 {{ store.dashboard.countdown.progress }}%</strong>
          <div class="bar"><i :style="{ width: `${store.dashboard.countdown.progress}%` }"></i></div>
          <span>{{ store.dashboard.countdown.label }}</span>
        </div>
      </section>
      <section v-else class="empty-plan app-card">
        <CalendarCheckIcon />
        <strong>还没有考试日期</strong>
        <span>新建备考计划后，这里会显示阶段和倒计时。</span>
        <button class="primary-button" type="button" @click="openCreateSheet">
          <PlusIcon /> 新建备考计划
        </button>
      </section>

      <section v-if="store.dashboard?.diagnosisSummary" class="diagnosis-card app-card">
        <div>
          <strong>今日计划依据</strong>
          <span>{{ store.dashboard.diagnosisSummary }}</span>
        </div>
        <button type="button" @click="router.push('/vue/quality-dashboard')">看诊断</button>
      </section>

      <section class="section">
        <div class="section-head"><strong>能力概览</strong></div>
        <div v-if="store.dashboard?.modules.length" class="module-list app-card">
          <button v-for="module in store.dashboard.modules" :key="module.name" type="button" class="module-row" @click="openModule(module.name)">
            <span>{{ module.name }}</span>
            <div><i :style="{ width: `${module.accuracy}%`, background: moduleColor(module.accuracy) }"></i></div>
            <em :style="{ color: moduleColor(module.accuracy) }">{{ module.accuracy }}%</em>
          </button>
        </div>
        <div v-else class="empty-inline app-card">暂无练习数据</div>
      </section>

      <section class="section">
        <div class="section-head">
          <strong>今日计划</strong>
          <span v-if="store.tasks.length">{{ store.doneCount }}/{{ store.tasks.length }} 已完成</span>
        </div>

        <div v-if="!store.tasks.length" class="empty-plan app-card">
          <CalendarCheckIcon />
          <strong>今日计划为空</strong>
          <span>根据能力画像和备考阶段生成每日任务。</span>
          <button class="primary-button" type="button" :disabled="store.isGenerating" @click="store.generate">
            <SparklesIcon /> {{ store.isGenerating ? '生成中...' : '生成今日计划' }}
          </button>
        </div>

        <div v-else class="task-card app-card">
          <button v-for="task in store.tasks" :key="task.id" type="button" class="plan-task" @click="openTask(task)">
            <span :class="['task-icon', task.type]"><component :is="taskIcon(task.type)" /></span>
            <span class="task-copy">
              <strong :class="{ done: task.done }">{{ task.text }}</strong>
              <em>{{ taskDetail(task) }}</em>
            </span>
            <span :class="['check', { done: task.done }]"></span>
          </button>
          <div class="plan-actions">
            <button type="button" @click="optimizePlan"><Wand2Icon /> AI 优化</button>
            <button type="button" :disabled="store.isGenerating" @click="store.generate"><RefreshCwIcon /> 重新生成</button>
          </div>
        </div>
      </section>

      <section v-if="store.dashboard?.history.length" class="section">
        <div class="section-head"><strong>近7天完成趋势</strong></div>
        <div class="history-card app-card">
          <div v-for="row in store.dashboard.history" :key="row.date" class="history-row">
            <span>{{ row.date.slice(5).replace('-', '/') }}</span>
            <div><i :style="{ width: `${row.percent}%`, background: moduleColor(row.percent) }"></i></div>
            <em>{{ row.done }}/{{ row.total }}</em>
          </div>
        </div>
      </section>
    </main>

    <BottomSheet v-model="showCreateSheet" title="新建备考计划" subtitle="创建后自动切换为当前本地工程" variant="form">
      <div class="sheet-form">
              <label>
                <span>计划名称</span>
                <input v-model.trim="createForm.name" placeholder="例如：广东省考冲刺" />
              </label>
              <div class="form-grid">
                <label>
                  <span>考试类型</span>
                  <div class="option-group">
                    <button
                      v-for="type in examTypeOptions"
                      :key="type"
                      type="button"
                      :class="{ active: createForm.examType === type }"
                      @click="createForm.examType = type"
                    >
                      {{ type }}
                    </button>
                  </div>
                </label>
                <label>
                  <span>省份</span>
                  <div class="province-picker">
                    <button
                      v-for="province in provinceOptions"
                      :key="province"
                      type="button"
                      :class="{ active: createForm.province === province }"
                      @click="createForm.province = province"
                    >
                      {{ province }}
                    </button>
                  </div>
                </label>
              </div>
              <div class="form-grid">
                <label>
                  <span>考试日期</span>
                  <input
                    v-model="createForm.examDate"
                    type="text"
                    inputmode="numeric"
                    maxlength="10"
                    placeholder="2026-11-29"
                    @input="formatCreateDateInput"
                  />
                </label>
                <label>
                  <span>套卷题量</span>
                  <input v-model.number="createForm.mockExamCount" type="number" min="10" max="200" step="5" />
                </label>
              </div>
              <label>
                <span>岗位/方向</span>
                <input v-model.trim="createForm.position" placeholder="可选" />
              </label>
              <label>
                <span>备考要求</span>
                <textarea v-model.trim="createForm.requirements" placeholder="每天学习时间、薄弱模块、目标分数等" />
              </label>
              <p v-if="createError" class="form-error">{{ createError }}</p>
              <button class="primary-button" type="button" :disabled="isCreating" @click="createPlan">
                <PlusIcon /> {{ isCreating ? '创建中...' : '创建计划' }}
              </button>
      </div>
    </BottomSheet>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ActivityIcon,
  BookOpenIcon,
  CalendarCheckIcon,
  Edit3Icon,
  FileTextIcon,
  MonitorIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SparklesIcon,
  Wand2Icon
} from 'lucide-vue-next';
import type { PlanTask } from '@/domain/plan';
import PageHeader from '@/components/layout/PageHeader.vue';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import { usePlanStore } from '@/stores/plan';
import { generationTaskService } from '@/services/GenerationTaskService';
import { essayFlowService } from '@/services/EssayFlowService';
import { practiceFlowService } from '@/services/PracticeFlowService';
import { useTasksStore } from '@/stores/tasks';
import { projectRepository } from '@/services/ProjectRepository';
import { examProfileRepository } from '@/services/ExamProfileRepository';

const store = usePlanStore();
const tasksStore = useTasksStore();
const router = useRouter();
const route = useRoute();
const showCreateSheet = ref(false);
const isCreating = ref(false);
const createError = ref('');
const examTypeOptions = ['省考', '国考', '事业单位', '选调生'];
const provinceOptions = [
  '全国', '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
  '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南',
  '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州',
  '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆'
];
const createForm = reactive({
  name: '',
  examType: '省考',
  province: '江西',
  examDate: '',
  mockExamCount: 120,
  position: '',
  requirements: ''
});

onMounted(() => {
  void store.load();
  if (route.query.new === '1') openCreateSheet();
});

function openCreateSheet() {
  createError.value = '';
  if (!createForm.name && store.dashboard?.projectName) createForm.name = `${store.dashboard.projectName}-新计划`;
  showCreateSheet.value = true;
}

function formatCreateDateInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const digits = input.value.replace(/\D/g, '').slice(0, 8);
  createForm.examDate = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean).join('-');
}

async function createPlan() {
  if (isCreating.value) return;
  const name = createForm.name.trim();
  if (!name) {
    createError.value = '请输入计划名称';
    return;
  }
  isCreating.value = true;
  createError.value = '';
  try {
    const project = await projectRepository.createProject({
      name,
      examType: createForm.examType,
      province: createForm.province.trim(),
      examDate: createForm.examDate,
      mockExamCount: Number(createForm.mockExamCount) || 120,
      position: createForm.position.trim(),
      requirements: createForm.requirements.trim()
    }, 'onboarding');
    await examProfileRepository.saveDraft(project.id, {
      examType: createForm.examType,
      examName: `${createForm.province.trim()}${createForm.examType}`.trim() || createForm.examType,
      province: createForm.province.trim(),
      examDate: createForm.examDate,
      position: createForm.position.trim(),
      requirements: createForm.requirements.trim()
    });
    await projectRepository.setActiveProject(project.id);
    showCreateSheet.value = false;
    await router.push('/vue');
    await store.load();
  } catch (error) {
    createError.value = error instanceof Error ? error.message : String(error);
  } finally {
    isCreating.value = false;
  }
}

function moduleColor(accuracy: number): string {
  if (accuracy >= 70) return 'var(--green-color)';
  if (accuracy >= 50) return 'var(--orange-color)';
  return 'var(--red-color)';
}

function taskIcon(type: PlanTask['type']) {
  return {
    diagnosis: ActivityIcon,
    practice: Edit3Icon,
    essay: FileTextIcon,
    review: RotateCcwIcon,
    digest: BookOpenIcon,
    mock: MonitorIcon
  }[type] || Edit3Icon;
}

function taskDetail(task: PlanTask): string {
  const parts = [];
  if (task.type === 'practice' || task.type === 'review') {
    if (task.target > 0) parts.push(`${task.actual || 0}/${task.target}`);
    else if ((task.actual || 0) > 0) parts.push(`${task.actual}题`);
    else parts.push('待练习');
  } else if (task.done) {
    parts.push('已完成');
  }
  if (task.reason) parts.push(task.reason);
  return parts.join(' · ') || task.sub || '点击进入';
}

function openModule(moduleName: string) {
  practiceFlowService.writeStartContext({
    module: moduleName,
    date: new Date().toISOString().slice(0, 10),
    mode: 'practice',
    source: 'plan',
    questionCount: 10
  });
  void router.push('/vue/practice/session');
}

function openTask(task: PlanTask) {
  if (task.type === 'essay') {
    essayFlowService.writeContext({
      date: new Date().toISOString().slice(0, 10),
      topic: task.text || '申论',
      type: 'short'
    });
    void router.push('/vue/essay');
    return;
  }
  if (task.type === 'review') {
    void router.push('/vue/wrongbook');
    return;
  }
  if (task.type === 'digest') {
    void router.push('/vue/digest');
    return;
  }
  if (task.type === 'mock') {
    void router.push('/vue/exam');
    return;
  }
  openModule(task.module || '资料分析');
}

async function optimizePlan() {
  await generationTaskService.enqueue({
    intent: 'daily',
    title: 'AI 优化今日计划',
    detail: '根据能力画像调整任务顺序和数量',
    sourceId: 'plan-optimize'
  });
  await tasksStore.refresh();
}
</script>

<style scoped>
.new-plan-btn { min-width: 58px; height: 36px; padding: 0 11px; border: none; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; color: var(--primary-color); background: rgba(var(--color-brand-rgb), .1); font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); font-family: inherit; flex-shrink: 0; }
.new-plan-btn svg { width: 15px; height: 15px; }
.plan-content { display: flex; flex-direction: column; gap: 14px; }
.countdown-card { display: flex; align-items: center; gap: 14px; padding: 16px; }
.cd-days { min-width: 58px; text-align: center; }
.cd-days strong { display: block; color: var(--primary-color); font-size: var(--type-size-metric); line-height: 1; }
.cd-days span, .cd-main span { color: var(--text-secondary-color); font-size: var(--type-size-micro); }
.cd-main { flex: 1; min-width: 0; }
.cd-main strong { color: var(--primary-color); font-size: var(--type-size-caption); }
.bar { height: 5px; margin: 7px 0 5px; border-radius: 999px; overflow: hidden; background: rgba(var(--color-ink-rgb), .08); }
.bar i { display: block; height: 100%; border-radius: inherit; background: var(--primary-color); }
.diagnosis-card { min-height: 62px; padding: 13px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.diagnosis-card div { min-width: 0; }
.diagnosis-card strong { display: block; font-size: var(--type-size-body); }
.diagnosis-card span { display: block; margin-top: 4px; color: var(--text-secondary-color); font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diagnosis-card button { height: 34px; border: none; border-radius: 999px; padding: 0 12px; flex-shrink: 0; color: var(--primary-color); background: rgba(var(--color-brand-rgb), .1); font: inherit; font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); }
.section { display: flex; flex-direction: column; gap: 9px; }
.section-head { display: flex; align-items: center; justify-content: space-between; }
.section-head strong { font-size: var(--type-size-body-large); }
.section-head span { color: var(--text-secondary-color); font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); }
.empty-plan { padding: 24px 18px; display: flex; flex-direction: column; align-items: center; gap: 9px; text-align: center; color: var(--text-secondary-color); }
.empty-plan svg { width: 34px; height: 34px; color: var(--primary-color); }
.empty-plan strong { color: var(--text-color); font-size: var(--type-size-control); }
.empty-plan span { font-size: var(--type-size-secondary); line-height: 1.5; }
.module-list, .task-card, .history-card { overflow: hidden; }
.module-row { width: 100%; min-height: 43px; display: flex; align-items: center; gap: 10px; padding: 0 14px; border: none; border-top: 1px solid rgba(var(--color-ink-rgb), .055); background: transparent; color: inherit; }
.module-row:first-child { border-top: none; }
.module-row span { width: 62px; flex-shrink: 0; text-align: left; font-size: var(--type-size-secondary); }
.module-row div, .history-row div { flex: 1; height: 6px; border-radius: 999px; overflow: hidden; background: rgba(var(--color-ink-rgb), .08); }
.module-row i, .history-row i { display: block; height: 100%; border-radius: inherit; }
.module-row em, .history-row em { width: 42px; text-align: right; font-size: var(--type-size-caption); font-style: normal; font-weight: var(--type-weight-semibold); }
.empty-inline { padding: 16px; color: var(--text-secondary-color); text-align: center; font-size: var(--type-size-secondary); }
.province-picker { max-height: 94px; display:flex; flex-wrap:wrap; gap:6px; overflow-y:auto; -webkit-overflow-scrolling:touch; }
.province-picker button { min-width:54px; min-height:31px; border:0; border-radius:999px; padding:0 10px; background:var(--surface-control); color:var(--text-secondary-color); font:inherit; font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }
.province-picker button.active { background:rgba(var(--color-brand-rgb), .12); color:var(--primary-color); }
.plan-task { width: 100%; min-height: 62px; display: flex; align-items: center; gap: 11px; padding: 11px 14px; border: none; border-top: 1px solid rgba(var(--color-ink-rgb), .055); background: transparent; color: inherit; text-align: left; }
.plan-task:first-child { border-top: none; }
.task-icon { width: 36px; height: 36px; border-radius: 11px; display: inline-flex; align-items: center; justify-content: center; color: var(--primary-color); background: rgba(var(--color-brand-rgb), .1); flex-shrink: 0; }
.task-icon svg { width: 18px; height: 18px; }
.task-icon.essay { color: var(--green-color); background: rgba(52,199,89,.12); }
.task-icon.review { color: var(--orange-color); background: rgba(255,149,0,.12); }
.task-icon.digest { color: #8e24aa; background: rgba(142,36,170,.12); }
.task-icon.mock { color: var(--red-color); background: rgba(255,59,48,.12); }
.task-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.task-copy strong { font-size: var(--type-size-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-copy strong.done { color: var(--text-secondary-color); text-decoration: line-through; }
.task-copy em { color: var(--text-secondary-color); font-size: var(--type-size-micro); font-style: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.check { width: 22px; height: 22px; border-radius: 999px; border: 2px solid var(--border-color); flex-shrink: 0; }
.check.done { border-color: var(--green-color); background: var(--green-color); }
.plan-actions { display: flex; gap: 8px; padding: 12px 14px; border-top: 1px solid rgba(var(--color-ink-rgb), .055); }
.plan-actions button { flex: 1; height: 38px; border: none; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: rgba(var(--color-brand-rgb), .1); color: var(--primary-color); font-size: var(--type-size-secondary); font-weight: var(--type-weight-semibold); }
.plan-actions button + button { background: rgba(var(--color-ink-rgb), .06); color: var(--text-secondary-color); }
.plan-actions svg { width: 15px; height: 15px; }
.history-row { min-height: 38px; display: flex; align-items: center; gap: 10px; padding: 0 14px; border-top: 1px solid rgba(var(--color-ink-rgb), .055); }
.history-row:first-child { border-top: none; }
.history-row span { width: 48px; font-size: var(--type-size-secondary); }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.form-error { margin: 0; color: var(--red-color); font-size: var(--type-size-caption); }
@media (max-width: 380px) {
  .form-grid { grid-template-columns: 1fr; }
}
</style>
