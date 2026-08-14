<template>
  <div class="onboarding-page app-page">
    <PageHeader title="建立备考档案" meta="目标和现状决定训练起点" :level="2" />

    <main class="onboarding-content">
      <nav class="step-nav" aria-label="建档步骤">
        <button
          v-for="item in stepItems"
          :key="item.step"
          type="button"
          :class="{ active: step === item.step, completed: step > item.step }"
          @click="goToStep(item.step)"
        >
          <span>{{ item.step }}</span>
          <em>{{ item.label }}</em>
        </button>
      </nav>

      <section v-if="step === 1" class="form-section">
        <header>
          <TargetIcon />
          <div>
            <h1>这次要考到哪里</h1>
            <p>只记录会影响教学决策的信息，后续都可以调整。</p>
          </div>
        </header>

        <FormField label="计划名称" :error="fieldErrors.projectName">
          <input v-model.trim="form.projectName" placeholder="例如：2027 国考" maxlength="80" />
        </FormField>
        <FormField v-if="examPackOptions.length > 1" label="备考方向">
          <SegmentedControl
            :model-value="form.examType"
            label="备考方向"
            :options="examPackOptions"
            @update:model-value="switchExamPack"
          />
        </FormField>
        <FormField v-if="isRegionScoped" label="考试范围">
          <SegmentedControl v-model="form.examScope" label="考试范围" :options="examScopeOptions" />
        </FormField>
        <div class="form-grid">
          <FormField label="考试日期" :error="fieldErrors.examDate">
            <input
              v-model="form.examDate"
              class="date-text-input"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              maxlength="10"
              placeholder="2027-11-29"
              @input="formatExamDateInput"
            />
          </FormField>
          <FormField v-if="isRegionScoped" label="报考地区">
            <div class="province-picker" role="listbox" aria-label="报考地区">
              <button
                v-for="item in provinceOptions"
                :key="item.value"
                type="button"
                :class="{ active: form.province === item.value }"
                @click="selectProvince(item.value)"
              >
                {{ item.label }}
              </button>
            </div>
          </FormField>
        </div>
        <FormField label="目标岗位" hint="可选，只用于调整岗位匹配和备考建议">
          <input v-model.trim="form.position" placeholder="例如：税务岗" />
        </FormField>
      </section>

      <section v-else-if="step === 2" class="form-section">
        <header>
          <GaugeIcon />
          <div>
            <h1>现状和目标分差</h1>
            <p>当前分是自报基线，后续会由诊断和模考逐步校准。</p>
          </div>
        </header>

        <div v-for="subject in scoredSubjects" :key="subject.code" class="score-block">
          <div class="score-heading">
            <strong>{{ subject.name }}</strong>
            <span>满分 {{ subject.score?.maxScore }}</span>
          </div>
          <div class="form-grid">
            <FormField label="当前分" hint="不确定可留空">
              <input v-model="form.currentScores[subject.code]" type="number" inputmode="decimal" min="0" :max="subject.score?.maxScore" step="0.5" placeholder="待诊断" />
            </FormField>
            <FormField label="目标分">
              <input v-model="form.targetScores[subject.code]" type="number" inputmode="decimal" min="0" :max="subject.score?.maxScore" step="0.5" />
            </FormField>
          </div>
        </div>
        <p v-if="fieldErrors.scores" class="section-error">{{ fieldErrors.scores }}</p>
      </section>

      <section v-else class="form-section">
        <header>
          <CalendarClockIcon />
          <div>
            <h1>安排可持续的节奏</h1>
            <p>AI 会在可用时间内安排训练，不用题量挤满每天。</p>
          </div>
        </header>

        <FormField label="备考状态">
          <SegmentedControl v-model="form.studyMode" label="备考状态" :options="studyModeOptions" />
        </FormField>
        <div class="form-grid">
          <FormField label="每周学习天数">
            <input v-model.number="form.weeklyStudyDays" type="number" inputmode="numeric" min="1" max="7" />
          </FormField>
          <FormField label="单次专注分钟">
            <input v-model.number="form.maxFocusMinutes" type="number" inputmode="numeric" min="5" max="240" step="5" />
          </FormField>
          <FormField label="工作日分钟">
            <input v-model.number="form.weekdayMinutes" type="number" inputmode="numeric" min="0" max="1440" step="10" />
          </FormField>
          <FormField label="周末分钟">
            <input v-model.number="form.weekendMinutes" type="number" inputmode="numeric" min="0" max="1440" step="10" />
          </FormField>
        </div>
        <FormField label="教学顺序">
          <SegmentedControl v-model="form.teachingOrder" label="教学顺序" :options="teachingOrderOptions" />
        </FormField>
        <FormField label="AI 主动程度">
          <SegmentedControl v-model="form.proactiveLevel" label="AI 主动程度" :options="proactiveOptions" />
        </FormField>
        <p v-if="fieldErrors.study" class="section-error">{{ fieldErrors.study }}</p>
      </section>

      <p v-if="submitMessage" class="submit-message" role="alert">{{ submitMessage }}</p>
    </main>

    <StickyActionBar>
      <button v-if="step > 1" type="button" @click="step -= 1">上一步</button>
      <button v-if="step < 3" class="primary" type="button" @click="nextStep">继续</button>
      <button v-else class="primary" type="button" :disabled="submitting" @click="submit">
        <LoaderCircleIcon v-if="submitting" class="spin" />
        <span>{{ submitting ? '正在建立' : '建立备考档案' }}</span>
      </button>
    </StickyActionBar>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  CalendarClockIcon,
  GaugeIcon,
  LoaderCircleIcon,
  TargetIcon
} from 'lucide-vue-next';
import PageHeader from '@/components/layout/PageHeader.vue';
import { FormField, SegmentedControl, StickyActionBar } from '@/capabilities/design-system/public';
import { initializeTutorRuntime } from '@/composition-root/public';
import { PROVINCE_OPTIONS } from '@/domain/labels';
import { ExamPhase, ProactiveLevel, StudyMode, TeachingOrder } from '@/modules/candidate/public';
import type { JsonObject, LocalDate, TimeZoneId } from '@/kernel/public';
import { OnboardingMessage, resolveOnboardingError } from './onboardingMessages';
import { OnboardingDraftFeature } from './OnboardingDraftFeature';
import { ExamPackSelectionFeature, type ExamPackOption } from './ExamPackSelectionFeature';
import {
  DEFAULT_STUDY_RHYTHM,
  ExamScope,
  applyScoreDefaults,
  examNameFor,
  parseExamScope,
  restoreScoreEntries,
  scoreValidationError,
  studyRhythmInput,
  subjectScoreInputs
} from './ExamProfileScores';
import { restoreFormFields } from './OnboardingDraftRestore';

const OnboardingStep = {
  Goal: 1,
  Baseline: 2,
  Rhythm: 3
} as const;

const ONBOARDING_DRAFT_STORAGE_KEY = 'tutor:onboarding:draft-id';
const router = useRouter();
const step = ref<number>(OnboardingStep.Goal);
const submitting = ref(false);
const submitMessage = ref('');
const draftCreatedAt = ref(Date.now());
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let draftFeaturePromise: Promise<OnboardingDraftFeature> | undefined;

const form = reactive({
  projectName: '',
  examType: '',
  examScope: DEFAULT_STUDY_RHYTHM.examScope as string,
  examDate: '',
  province: '',
  position: '',
  /** Keyed by subject code: the exam package decides which subjects are scored. */
  currentScores: {} as Record<string, string>,
  targetScores: {} as Record<string, string>,
  studyMode: DEFAULT_STUDY_RHYTHM.studyMode as string,
  weeklyStudyDays: 6,
  weekdayMinutes: 120,
  weekendMinutes: 240,
  maxFocusMinutes: 50,
  teachingOrder: DEFAULT_STUDY_RHYTHM.teachingOrder as string,
  proactiveLevel: DEFAULT_STUDY_RHYTHM.proactiveLevel as string
});

const fieldErrors = reactive({ projectName: '', examDate: '', scores: '', study: '' });
const stepItems = [
  { step: OnboardingStep.Goal, label: '目标' },
  { step: OnboardingStep.Baseline, label: '分差' },
  { step: OnboardingStep.Rhythm, label: '节奏' }
] as const;
const examScopeOptions = [
  { value: ExamScope.National, label: '国考' },
  { value: ExamScope.Provincial, label: '省考' }
] as const;
const studyModeOptions = [
  { value: StudyMode.PartTime, label: '在职' },
  { value: StudyMode.FullTime, label: '全职' },
  { value: StudyMode.Mixed, label: '弹性' }
] as const;
const teachingOrderOptions = [
  { value: TeachingOrder.DiagnoseThenExplain, label: '先诊断' },
  { value: TeachingOrder.ExplainThenPractice, label: '先讲解' },
  { value: TeachingOrder.PracticeThenExplain, label: '先练习' }
] as const;
const proactiveOptions = [
  { value: ProactiveLevel.Quiet, label: '少打扰' },
  { value: ProactiveLevel.Balanced, label: '适中' },
  { value: ProactiveLevel.Active, label: '主动督学' }
] as const;
const examPacks = ref<readonly ExamPackOption[]>([]);
const activePack = computed(() => examPacks.value.find((pack) => pack.examType === form.examType));
const scoredSubjects = computed(() => activePack.value?.scoredSubjects ?? []);
const examPackOptions = computed(() => examPacks.value.map((pack) => ({ value: pack.examType, label: pack.examName })));
// Scope and province are only meaningful for tracks sat at more than one level.
const isRegionScoped = computed(() => activePack.value?.regionScoped ?? false);
const provincialProvinceOptions = PROVINCE_OPTIONS.map((name) => ({ value: name, label: name }));
const provinceOptions = computed(() => (
  form.examScope === ExamScope.National
    ? [{ value: '全国', label: '全国' }]
    : provincialProvinceOptions
));

watch(() => form.examScope, (scope) => {
  if (scope === ExamScope.National) {
    form.province = '全国';
    return;
  }
  if (!provincialProvinceOptions.some((item) => item.value === form.province)) {
    form.province = '江西';
  }
}, { immediate: true });

onMounted(async () => {
  await loadExamPacks();
  await restoreDraft();
  watch(form, scheduleDraftSave, { deep: true });
});

/** Offered tracks and their scored subjects come from the installed packages. */
async function loadExamPacks() {
  examPacks.value = await new ExamPackSelectionFeature(await initializeTutorRuntime()).load();
  const restored = examPacks.value.find((pack) => pack.examType === form.examType);
  form.examType = (restored ?? examPacks.value[0])?.examType ?? '';
  applyScoreDefaults(scoredSubjects.value, form.currentScores, form.targetScores);
}

function switchExamPack(examType: string) {
  if (form.examType === examType) return;
  form.examType = examType;
  form.currentScores = {};
  form.targetScores = {};
  applyScoreDefaults(scoredSubjects.value, form.currentScores, form.targetScores);
}

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
});

function draftId(): string {
  const existing = localStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
  if (existing) return existing;
  const created = `onboarding:${crypto.randomUUID()}`;
  localStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, created);
  return created;
}

async function restoreDraft() {
  try {
    const saved = await (await draftFeature()).load(draftId());
    if (!saved) return;
    draftCreatedAt.value = saved.createdAt;
    const data = saved.data;
    restoreFormFields(form, data);
    // A draft can outlive the package it was written against, so the track and
    // every restored score is re-checked instead of trusted.
    if (!examPacks.value.some((pack) => pack.examType === form.examType)) {
      form.examType = examPacks.value[0]?.examType ?? '';
    }
    restoreScoreEntries(scoredSubjects.value, data, form.currentScores, form.targetScores);
    applyScoreDefaults(scoredSubjects.value, form.currentScores, form.targetScores);
  } catch {
    submitMessage.value = OnboardingMessage.SaveFailed;
  }
}

function scheduleDraftSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveDraft(), 350);
}

async function saveDraft() {
  try {
    await (await draftFeature()).save({
      draftId: draftId(),
      step: step.value,
      data: JSON.parse(JSON.stringify(form)) as JsonObject,
      createdAt: draftCreatedAt.value
    });
  } catch {
    submitMessage.value = OnboardingMessage.SaveFailed;
  }
}
function draftFeature(): Promise<OnboardingDraftFeature> {
  draftFeaturePromise ??= initializeTutorRuntime().then((runtime) => new OnboardingDraftFeature(runtime));
  return draftFeaturePromise;
}

function goToStep(target: number) {
  if (target <= step.value || validateStep(step.value)) step.value = target;
}

function selectProvince(value: string) {
  form.province = value;
}

function nextStep() {
  if (validateStep(step.value)) step.value += 1;
}

function validateStep(target: number): boolean {
  fieldErrors.projectName = '';
  fieldErrors.examDate = '';
  fieldErrors.scores = '';
  fieldErrors.study = '';
  submitMessage.value = '';
  if (target === OnboardingStep.Goal) {
    if (!form.projectName.trim()) fieldErrors.projectName = OnboardingMessage.RequiredField;
    if (!isValidLocalDate(form.examDate)) fieldErrors.examDate = OnboardingMessage.InvalidDate;
    return !fieldErrors.projectName && !fieldErrors.examDate;
  }
  if (target === OnboardingStep.Baseline) {
    fieldErrors.scores = scoreValidationError(scoredSubjects.value, form.currentScores, form.targetScores) ?? '';
    return !fieldErrors.scores;
  }
  if (
    form.weeklyStudyDays < 1 || form.weeklyStudyDays > 7
    || form.weekdayMinutes < 0 || form.weekdayMinutes > 1440
    || form.weekendMinutes < 0 || form.weekendMinutes > 1440
    || form.maxFocusMinutes < 5 || form.maxFocusMinutes > 240
  ) {
    fieldErrors.study = OnboardingMessage.RequiredField;
  }
  return !fieldErrors.study;
}

async function submit() {
  if (submitting.value) return;
  const pack = activePack.value;
  if (!pack) {
    submitMessage.value = OnboardingMessage.ExamPackUnavailable;
    return;
  }
  if (!validateStep(OnboardingStep.Rhythm)) return;
  submitting.value = true;
  submitMessage.value = '';
  try {
    if (saveTimer) clearTimeout(saveTimer);
    await saveDraft();
    const runtime = await initializeTutorRuntime();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    await runtime.createCandidateCycle.execute({
      idempotencyKey: `${draftId()}:create-cycle`,
      draftId: draftId(),
      projectName: form.projectName,
      timeZone: timeZone as TimeZoneId,
      examType: pack.examType,
      examName: examNameFor(pack, parseExamScope(form.examScope) ?? ExamScope.National, form.province),
      province: form.province,
      position: form.position,
      examDate: form.examDate as LocalDate,
      phase: ExamPhase.Foundation,
      curriculumVersionId: pack.curriculumVersionId,
      subjectScores: subjectScoreInputs(scoredSubjects.value, form.currentScores, form.targetScores),
      ...studyRhythmInput(form)
    });
    localStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
    // The runtime was built before this candidate existed, so it is still on the
    // seed track. Point it at theirs before leaving, or every page after this
    // one reads another exam's labels, prompts and scoring rules.
    await runtime.activateExamPack();
    await router.replace('/vue/diagnosis');
  } catch (error) {
    submitMessage.value = resolveOnboardingError(error);
  } finally {
    submitting.value = false;
  }
}

function formatExamDateInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const digits = input.value.replace(/\D/g, '').slice(0, 8);
  const next = [
    digits.slice(0, 4),
    digits.slice(4, 6),
    digits.slice(6, 8)
  ].filter(Boolean).join('-');
  form.examDate = next;
}

function isValidLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}
</script>

<style scoped>
.onboarding-page {
  height: 100%;
  min-height: 0;
}

.onboarding-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px var(--page-x) 24px;
  -webkit-overflow-scrolling: touch;
}

.step-nav {
  width: min(100%, 560px);
  margin: 0 auto 18px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border-radius: var(--radius-pill);
  background: var(--surface-muted);
}

.step-nav button {
  min-width: 0;
  min-height: 38px;
  border: none;
  border-radius: var(--radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: transparent;
  color: var(--text-secondary-color);
  font: inherit;
}

.step-nav span {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--color-ink-rgb), .06);
  font-size: var(--type-size-micro);
}

.step-nav em {
  font-size: var(--type-size-secondary);
  font-style: normal;
}

.step-nav button.active {
  background: var(--surface-card-strong);
  color: var(--primary-color);
  box-shadow: var(--shadow-card);
}

.step-nav button.completed span {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.form-section {
  width: min(100%, 560px);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.form-section > header {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 2px 2px 6px;
}

.form-section > header > svg {
  width: 22px;
  height: 22px;
  margin-top: 2px;
  color: var(--primary-color);
  flex-shrink: 0;
}

.form-section h1 {
  margin: 0;
  font-size: var(--type-size-section-title);
  font-weight: var(--type-weight-semibold);
  line-height: var(--type-line-title);
}

.form-section p {
  margin: 3px 0 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  line-height: 1.55;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.date-text-input {
  letter-spacing: .02em;
  font-variant-numeric: tabular-nums;
}

.province-picker {
  max-height: 94px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.province-picker button {
  min-width: 54px;
  min-height: 31px;
  border: none;
  border-radius: 999px;
  padding: 0 10px;
  background: var(--surface-control);
  color: var(--text-secondary-color);
  font: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}

.province-picker button.active {
  background: rgba(var(--color-brand-rgb), .12);
  color: var(--primary-color);
}

.score-block {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 13px;
  border-radius: var(--radius-card);
  background: var(--surface-card);
}

.score-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.score-heading strong {
  font-size: var(--type-size-body-large);
  font-weight: var(--type-weight-medium);
}

.score-heading span {
  color: var(--color-text-tertiary);
  font-size: var(--type-size-caption);
}

.section-error,
.submit-message {
  color: var(--color-danger) !important;
  font-size: var(--type-size-secondary) !important;
}

.submit-message {
  width: min(100%, 560px);
  margin: 14px auto 0;
  text-align: center;
}

.spin {
  width: 17px;
  height: 17px;
  margin-right: 7px;
  animation: onboarding-spin .8s linear infinite;
}

@keyframes onboarding-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 380px) {
  .form-grid {
    gap: 9px;
  }

  .step-nav em {
    font-size: var(--type-size-caption);
  }
}
</style>
