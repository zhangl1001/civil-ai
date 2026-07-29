<template>
  <BottomSheet
    :model-value="modelValue"
    title="确认真题草稿"
    :subtitle="sourceTitle"
    variant="form"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="draft-summary">
      <span><strong>{{ draft.candidates.length }}</strong>候选题</span>
      <span><strong>{{ readyCandidates.length }}</strong>可入库</span>
      <span v-if="pendingCandidates.length"><strong>{{ pendingCandidates.length }}</strong>待补充</span>
    </div>

    <p v-if="draft.draft.issues.length" class="draft-warning">
      来源信息还不完整：{{ draft.draft.issues.map((issue) => issueLabel(issue.code)).join('、') }}
    </p>

    <div class="draft-list" role="list">
      <article v-for="candidate in draft.candidates" :key="candidate.id" role="listitem">
        <div class="candidate-heading">
          <span>第 {{ candidate.sequence }} 题</span>
          <em :class="candidate.status">{{ candidateStatus(candidate.status) }}</em>
        </div>
        <p>{{ candidatePrompt(candidate) }}</p>
        <small v-if="candidate.issues.length">
          {{ candidate.issues.map((issue) => issueLabel(issue.code)).join('、') }}
        </small>
      </article>
    </div>

    <p v-if="error" class="draft-error">{{ error }}</p>
    <button
      type="button"
      class="publish-button"
      :disabled="busy || !readyCandidates.length || draft.draft.issues.length > 0"
      @click="$emit('publish')"
    >
      <LoaderCircleIcon v-if="busy" class="spinning" />
      <CheckIcon v-else />
      {{ busy ? '正在写入题库' : `确认并导入 ${readyCandidates.length} 道可用题` }}
    </button>
    <p v-if="pendingCandidates.length" class="draft-note">缺少题干或选项的候选不会入库；缺少答案时需补充确认后再导入。</p>
  </BottomSheet>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CheckIcon, LoaderCircleIcon } from 'lucide-vue-next';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import {
  QuestionImportCandidateStatus,
  type QuestionImportDraftAggregate
} from '@/modules/content/public';

const props = defineProps<{
  modelValue: boolean;
  draft: QuestionImportDraftAggregate;
  busy: boolean;
  error?: string;
}>();

defineEmits<{
  'update:modelValue': [value: boolean];
  publish: [];
}>();

const readyCandidates = computed(() => props.draft.candidates.filter((candidate) => (
  candidate.status === QuestionImportCandidateStatus.Ready
)));
const pendingCandidates = computed(() => props.draft.candidates.filter((candidate) => (
  candidate.status === QuestionImportCandidateStatus.NeedsConfirmation
)));
const sourceTitle = computed(() => [
  props.draft.draft.sourceMetadata.examYear ? `${props.draft.draft.sourceMetadata.examYear}年` : '',
  props.draft.draft.sourceMetadata.province,
  props.draft.draft.sourceMetadata.paperName
].filter(Boolean).join(' · ') || '联网核验结果');

function candidatePrompt(candidate: QuestionImportDraftAggregate['candidates'][number]): string {
  const raw = candidate.raw;
  const prompt = typeof raw.prompt === 'string' ? raw.prompt : '';
  return prompt.trim() || '题干暂时无法完整读取';
}

function candidateStatus(status: string): string {
  if (status === QuestionImportCandidateStatus.Ready) return '结构完整';
  if (status === QuestionImportCandidateStatus.Published) return '已入库';
  if (status === QuestionImportCandidateStatus.Rejected) return '已忽略';
  return '待补充';
}

function issueLabel(code: string): string {
  return ({
    invalid_structure: '结构不完整',
    missing_answer: '缺少答案',
    answer_conflict: '答案冲突',
    invalid_options: '选项不完整',
    missing_source_identity: '来源身份不完整',
    capability_unresolved: '考点待确认',
    duplicate_sequence: '题号重复'
  } as Record<string, string>)[code] || '需要确认';
}
</script>

<style scoped>
.draft-summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; }
.draft-summary span { min-width:0; padding:8px 4px; border-radius:10px; color:var(--text-secondary-color); background:rgba(var(--color-ink-rgb),.035); font-size:var(--type-size-micro); text-align:center; }
.draft-summary strong { display:block; color:var(--text-color); font-size:var(--type-size-body); }
.draft-warning,.draft-error,.draft-note { margin:0; font-size:var(--type-size-caption); line-height:1.5; }
.draft-warning { color:var(--orange-color); }
.draft-error { color:var(--red-color); }
.draft-note { color:var(--text-secondary-color); text-align:center; }
.draft-list { max-height:min(42dvh,360px); overflow-y:auto; overscroll-behavior:contain; padding:0 2px; }
.draft-list article { padding:11px 2px; border-bottom:1px solid rgba(var(--color-ink-rgb),.06); }
.draft-list article:last-child { border-bottom:0; }
.candidate-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.candidate-heading span { font-size:var(--type-size-caption); font-weight:var(--type-weight-semibold); }
.candidate-heading em { color:var(--text-secondary-color); font-size:var(--type-size-micro); font-style:normal; }
.candidate-heading em.ready { color:var(--green-color); }
.candidate-heading em.needs_confirmation { color:var(--orange-color); }
.draft-list p { margin:6px 0 0; color:var(--text-color); font-size:var(--type-size-secondary); line-height:1.55; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.draft-list small { display:block; margin-top:5px; color:var(--orange-color); font-size:var(--type-size-micro); }
.publish-button { min-height:44px; border:0; border-radius:12px; display:flex; align-items:center; justify-content:center; gap:7px; color:#fff; background:var(--primary-color); font:inherit; font-weight:var(--type-weight-semibold); }
.publish-button:disabled { opacity:.45; }
.publish-button svg { width:17px; height:17px; }
.spinning { animation:spin .85s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
</style>
