<template>
  <div class="true-library-actions">
    <button type="button" class="library-tool" @click="$emit('filter')">
      <i><ListFilterIcon /></i>
      <span><strong>筛选真题</strong><em>{{ filterSummary }}</em></span>
    </button>
    <button type="button" class="library-tool" :disabled="importing" @click="fileInput?.click()">
      <i><LoaderCircleIcon v-if="importing" class="spinning" /><UploadIcon v-else /></i>
      <span><strong>{{ importing ? '正在读取' : '文件导入' }}</strong><em>PDF、文本或题库文件</em></span>
    </button>
    <button v-if="nativeCameraAvailable" type="button" class="library-tool" :disabled="importing || takingPhoto" @click="takePhoto">
      <i><LoaderCircleIcon v-if="takingPhoto" class="spinning" /><CameraIcon v-else /></i>
      <span><strong>{{ takingPhoto ? '正在打开' : '拍照导入' }}</strong><em>拍摄试卷或题目</em></span>
    </button>
    <button type="button" :class="['library-tool', { 'research-tool': !nativeCameraAvailable }]" :disabled="researching" @click="$emit('research')">
      <i><LoaderCircleIcon v-if="researching" class="spinning" /><SearchIcon v-else /></i>
      <span><strong>{{ researching ? '任务已受理' : 'AI 联网找题' }}</strong><em>{{ researching ? '可在任务中心查看进度' : '检索公开来源，核验后进入题库' }}</em></span>
    </button>
    <input ref="fileInput" hidden type="file" multiple :accept="DOCUMENT_FILE_IMPORT_ACCEPT" @change="selectFiles" />
    <button type="button" class="practice-action" :disabled="launching || !setCount" @click="$emit('special')">
      <TargetIcon />
      <span><strong>专项练习</strong><em>从当前范围抽取 {{ practiceCount }} 题</em></span>
    </button>
    <button type="button" class="practice-action" :disabled="launching || !completedCount" @click="$emit('retest')">
      <Repeat2Icon />
      <span><strong>真题复测</strong><em>{{ completedCount ? `${completedCount}套可复测` : '完成后可复测' }}</em></span>
    </button>
    <ConfirmDialog
      v-model="showCameraPermissionDialog"
      title="需要相机权限"
      :description="cameraPermissionDescription"
      confirm-text="去设置"
      @confirm="openCameraSettings"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { CameraIcon, ListFilterIcon, LoaderCircleIcon, Repeat2Icon, SearchIcon, TargetIcon, UploadIcon } from 'lucide-vue-next';
import ConfirmDialog from '@/components/layout/ConfirmDialog.vue';
import { DOCUMENT_FILE_IMPORT_ACCEPT } from '@/platform/DocumentTextExtractionService';
import { useTrueQuestionCapture } from './useTrueQuestionCapture';

const props = defineProps<{
  filterSummary: string;
  practiceCount: number;
  setCount: number;
  completedCount: number;
  launching: boolean;
  importing: boolean;
  researching: boolean;
}>();

const emit = defineEmits<{
  filter: [];
  research: [];
  special: [];
  retest: [];
  importFile: [files: readonly File[]];
  captureError: [message: string];
}>();
const fileInput = ref<HTMLInputElement | null>(null);
const {
  nativeCameraAvailable,
  takingPhoto,
  permissionDescription: cameraPermissionDescription,
  showPermissionDialog: showCameraPermissionDialog,
  capturePhoto: takePhoto,
  openCameraSettings
} = useTrueQuestionCapture({
  onCaptured: (files) => emit('importFile', files),
  onError: (message) => emit('captureError', message),
  isBusy: () => props.importing
});

function selectFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files ? [...input.files] : [];
  input.value = '';
  if (files.length) emit('importFile', files);
}
</script>

<style scoped>
.true-library-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.library-tool,.practice-action { min-width:0; min-height:60px; border:0; border-radius:var(--radius-card); padding:10px; color:inherit; background:rgba(var(--color-surface-rgb),.58); box-shadow:var(--shadow-card); text-align:left; font:inherit; }
.library-tool { display:grid; grid-template-columns:32px minmax(0,1fr); align-items:center; gap:8px; }
.research-tool { grid-column:1/-1; }
.library-tool i { width:32px; height:32px; display:grid; place-items:center; border-radius:10px; color:var(--primary-color); background:rgba(var(--color-brand-rgb),.1); }
.library-tool svg,.practice-action>svg { width:17px; height:17px; }
.library-tool span,.practice-action span { min-width:0; }
.library-tool strong,.library-tool em,.practice-action strong,.practice-action em { display:block; }
.library-tool strong,.practice-action strong { font-size:var(--type-size-caption); }
.library-tool em,.practice-action em { margin-top:3px; overflow:hidden; color:var(--text-secondary-color); font-size:var(--type-size-micro); font-style:normal; text-overflow:ellipsis; white-space:nowrap; }
.practice-action { display:flex; align-items:center; gap:9px; }
.practice-action>svg { flex:0 0 auto; color:var(--primary-color); }
button:disabled { opacity:.45; }
.spinning { animation:spin .85s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
</style>
