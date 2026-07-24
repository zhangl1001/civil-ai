<template>
  <div class="appearance-settings">
    <section class="appearance-section">
      <div class="appearance-heading">
        <strong>界面主题</strong>
        <span>颜色与组件层级会全局同步</span>
      </div>
      <div class="theme-options">
        <button
          v-for="preset in THEME_PRESETS"
          :key="preset.id"
          type="button"
          :class="['theme-option', `theme-option-${preset.id}`, { active: settings.preset === preset.id }]"
          @click="selectPreset(preset.id)"
        >
          <i aria-hidden="true"></i>
          <strong>{{ preset.name }}</strong>
          <span>{{ preset.description }}</span>
        </button>
      </div>
    </section>

    <section class="appearance-section">
      <div class="appearance-heading">
        <strong>个性背景</strong>
        <span>图片仅保存在本机，自动压缩后应用</span>
      </div>
      <button class="image-picker" type="button" @click="imageInput?.click()">
        <ImagePlusIcon />
        <span>{{ settings.backgroundImage ? '更换背景图片' : '选择背景图片' }}</span>
      </button>
      <input ref="imageInput" class="visually-hidden" type="file" accept="image/*" @change="handleImage" />
      <div v-if="cropSource" class="crop-panel">
        <div ref="cropFrame" class="crop-frame" :style="{ aspectRatio: cropAspect }" @pointerdown="startDrag">
          <img
            :src="cropSource"
            alt=""
            draggable="false"
            :style="cropImageStyle"
            @load="onCropImageLoad"
          />
          <div class="crop-mask"></div>
          <span class="crop-hint">拖动调整位置</span>
        </div>
        <label class="zoom-field">
          <span>缩放</span>
          <input v-model.number="cropZoom" type="range" min="1" max="3" step="0.01" />
          <em>{{ Math.round(cropZoom * 100) }}%</em>
        </label>
        <div class="crop-actions">
          <button type="button" class="crop-cancel" @click="cancelCrop">取消</button>
          <button type="button" class="crop-confirm" @click="applyCrop">应用背景</button>
        </div>
      </div>
      <label v-if="settings.backgroundImage" class="strength-field">
        <span>背景清晰度</span>
        <input v-model.number="settings.backgroundStrength" type="range" min="20" max="85" step="1" @change="saveStrength" />
        <em>{{ settings.backgroundStrength }}%</em>
      </label>
      <button v-if="settings.backgroundImage" class="clear-image" type="button" @click="clearImage">
        <Trash2Icon />
        <span>移除自定义背景</span>
      </button>
      <p v-if="message" class="appearance-message">{{ message }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { ImagePlusIcon, Trash2Icon } from 'lucide-vue-next';
import { THEME_PRESETS, themeService, type ThemePresetId, type ThemeSettings } from '@/services/ThemeService';

const emit = defineEmits<{ change: [settings: ThemeSettings] }>();
const imageInput = ref<HTMLInputElement | null>(null);
const cropFrame = ref<HTMLElement | null>(null);
const message = ref('');
const settings = reactive<ThemeSettings>(themeService.getCurrent());
const cropSource = ref('');
const cropZoom = ref(1);
const cropOffset = reactive({ x: 0, y: 0 });
const cropImageSize = reactive({ width: 0, height: 0 });
const cropFrameSize = reactive({ width: 0, height: 0 });
const cropDrag = reactive({ active: false, pointerId: 0, startX: 0, startY: 0, originX: 0, originY: 0 });
const cropAspect = computed(() => `${Math.max(1, window.innerWidth)} / ${Math.max(1, window.innerHeight)}`);
const cropImageStyle = computed(() => ({
  width: `${cropDisplaySize.value.width}px`,
  height: `${cropDisplaySize.value.height}px`,
  transform: `translate(-50%, -50%) translate(${cropOffset.x}px, ${cropOffset.y}px) scale(${cropZoom.value})`
}));
const cropDisplaySize = computed(() => {
  if (!cropImageSize.width || !cropImageSize.height || !cropFrameSize.width || !cropFrameSize.height) {
    return { width: 0, height: 0 };
  }
  const coverScale = Math.max(cropFrameSize.width / cropImageSize.width, cropFrameSize.height / cropImageSize.height);
  return {
    width: Math.round(cropImageSize.width * coverScale),
    height: Math.round(cropImageSize.height * coverScale)
  };
});

function update(next: ThemeSettings) {
  Object.assign(settings, next);
  emit('change', next);
}

onMounted(async () => {
  update(await themeService.initialize());
  window.addEventListener('resize', measureCropFrame);
});

watch(cropZoom, clampCropOffset);

onUnmounted(() => {
  window.removeEventListener('resize', measureCropFrame);
  window.removeEventListener('pointermove', dragCrop);
  window.removeEventListener('pointerup', stopDrag);
});

async function selectPreset(preset: ThemePresetId) {
  message.value = '';
  update(await themeService.setPreset(preset));
}

async function handleImage(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (!file) return;
  try {
    validateImageFile(file);
    cropSource.value = await fileToDataUrl(file);
    cropZoom.value = 1;
    cropOffset.x = 0;
    cropOffset.y = 0;
    message.value = '调整图片位置后应用背景';
  } catch (error) {
    message.value = error instanceof Error ? error.message : '背景设置失败';
  }
}

function validateImageFile(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > 16 * 1024 * 1024) throw new Error('图片不能超过 16 MB');
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function onCropImageLoad(event: Event) {
  const image = event.target as HTMLImageElement;
  cropImageSize.width = image.naturalWidth;
  cropImageSize.height = image.naturalHeight;
  cropOffset.x = 0;
  cropOffset.y = 0;
  cropZoom.value = 1;
  void nextTick(measureCropFrame);
}

function measureCropFrame() {
  const frame = cropFrame.value?.getBoundingClientRect();
  if (!frame) return;
  cropFrameSize.width = frame.width;
  cropFrameSize.height = frame.height;
  clampCropOffset();
}

function startDrag(event: PointerEvent) {
  if (!cropSource.value) return;
  cropDrag.active = true;
  cropDrag.pointerId = event.pointerId;
  cropDrag.startX = event.clientX;
  cropDrag.startY = event.clientY;
  cropDrag.originX = cropOffset.x;
  cropDrag.originY = cropOffset.y;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  window.addEventListener('pointermove', dragCrop);
  window.addEventListener('pointerup', stopDrag);
}

function dragCrop(event: PointerEvent) {
  if (!cropDrag.active) return;
  cropOffset.x = cropDrag.originX + event.clientX - cropDrag.startX;
  cropOffset.y = cropDrag.originY + event.clientY - cropDrag.startY;
  clampCropOffset();
}

function stopDrag(event: PointerEvent) {
  if (cropDrag.pointerId && event.pointerId !== cropDrag.pointerId) return;
  cropDrag.active = false;
  cropDrag.pointerId = 0;
  window.removeEventListener('pointermove', dragCrop);
  window.removeEventListener('pointerup', stopDrag);
}

function cancelCrop() {
  cropSource.value = '';
  cropOffset.x = 0;
  cropOffset.y = 0;
  cropZoom.value = 1;
  message.value = '';
}

function clampCropOffset() {
  const displayWidth = cropDisplaySize.value.width * cropZoom.value;
  const displayHeight = cropDisplaySize.value.height * cropZoom.value;
  const maxX = Math.max(0, (displayWidth - cropFrameSize.width) / 2);
  const maxY = Math.max(0, (displayHeight - cropFrameSize.height) / 2);
  cropOffset.x = Math.min(maxX, Math.max(-maxX, cropOffset.x));
  cropOffset.y = Math.min(maxY, Math.max(-maxY, cropOffset.y));
}

async function applyCrop() {
  if (!cropSource.value || !cropFrame.value || !cropImageSize.width || !cropImageSize.height) return;
  message.value = '正在裁切图片...';
  try {
    const frame = cropFrame.value.getBoundingClientRect();
    const frameWidth = Math.max(1, frame.width);
    const frameHeight = Math.max(1, frame.height);
    const isPortrait = frameHeight >= frameWidth;
    const outputHeight = isPortrait ? 1800 : Math.round(1800 * frameHeight / frameWidth);
    const outputWidth = isPortrait ? Math.round(1800 * frameWidth / frameHeight) : 1800;
    const image = await loadImage(cropSource.value);
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前设备无法处理图片');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    const coverScale = Math.max(frameWidth / image.naturalWidth, frameHeight / image.naturalHeight);
    const displayWidth = image.naturalWidth * coverScale * cropZoom.value;
    const displayHeight = image.naturalHeight * coverScale * cropZoom.value;
    const outputScaleX = outputWidth / frameWidth;
    const outputScaleY = outputHeight / frameHeight;
    const drawX = (frameWidth / 2 + cropOffset.x - displayWidth / 2) * outputScaleX;
    const drawY = (frameHeight / 2 + cropOffset.y - displayHeight / 2) * outputScaleY;
    context.drawImage(image, drawX, drawY, displayWidth * outputScaleX, displayHeight * outputScaleY);

    update(await themeService.setCustomBackgroundDataUrl(canvas.toDataURL('image/jpeg', .84)));
    cancelCrop();
    message.value = '背景已裁切并保存在本机';
  } catch (error) {
    message.value = error instanceof Error ? error.message : '背景裁切失败';
  }
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片格式无法识别'));
    image.src = source;
  });
}

async function saveStrength() {
  update(await themeService.setBackgroundStrength(settings.backgroundStrength));
}

async function clearImage() {
  update(await themeService.clearCustomBackground());
  message.value = '已恢复主题背景';
}
</script>

<style scoped>
.appearance-settings,
.appearance-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.appearance-section {
  padding: 10px;
  border-radius: var(--radius-card);
  background: var(--surface-card);
}

.appearance-heading strong,
.appearance-heading span {
  display: block;
}

.appearance-heading strong {
  font-size: var(--type-size-body-large);
  font-weight: var(--type-weight-semibold);
}

.appearance-heading span {
  margin-top: 2px;
  color: var(--color-text-secondary);
  font-size: var(--type-size-caption);
}

.theme-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.theme-option {
  min-width: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  padding: 8px 6px;
  background: var(--surface-control);
  color: var(--color-text-primary);
  text-align: left;
}

.theme-option.active {
  border-color: var(--border-focus);
  box-shadow: inset 0 0 0 1px var(--color-brand-soft);
}

.theme-option i {
  display: block;
  width: 100%;
  height: 28px;
  margin-bottom: 7px;
  border-radius: 7px;
  background: linear-gradient(120deg, #dfeaff, #f8fafc 54%, #e0f3e8);
}

.theme-option-quiet-jade i { background: linear-gradient(120deg, #dcefe9, #f7fbfa 54%, #e2ebf5); }
.theme-option-soft-rose i { background: linear-gradient(120deg, #f4e0e7, #fcf9fb 54%, #e1efec); }
.theme-option strong,
.theme-option span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.theme-option strong { font-size: var(--type-size-caption); font-weight: var(--type-weight-semibold); }
.theme-option span { margin-top: 1px; color: var(--color-text-tertiary); font-size: var(--type-size-micro); }

.image-picker,
.clear-image {
  min-height: 42px;
  border: none;
  border-radius: var(--radius-control);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  background: var(--surface-control);
  color: var(--color-brand);
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}

.image-picker svg,
.clear-image svg { width: 17px; height: 17px; }
.clear-image { color: var(--color-danger); }

.crop-panel {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.crop-frame {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: var(--radius-card);
  background:
    linear-gradient(135deg, rgba(var(--color-ink-rgb), .045) 25%, transparent 25%) 0 0 / 18px 18px,
    linear-gradient(135deg, transparent 75%, rgba(var(--color-ink-rgb), .045) 75%) 0 0 / 18px 18px,
    var(--surface-muted);
  touch-action: none;
  user-select: none;
}

.crop-frame img {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: none;
  max-height: none;
  object-fit: contain;
  transform-origin: center;
  will-change: transform;
  pointer-events: none;
}

.crop-mask {
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 0 1px rgba(var(--color-ink-rgb), .08), inset 0 0 0 999px rgba(255, 255, 255, .02);
}

.crop-mask::before,
.crop-mask::after {
  content: '';
  position: absolute;
  inset: 33.333% 0 auto;
  height: 1px;
  background: rgba(255, 255, 255, .45);
}

.crop-mask::after {
  inset: 66.666% 0 auto;
}

.crop-hint {
  position: absolute;
  left: 50%;
  bottom: 8px;
  transform: translateX(-50%);
  padding: 4px 9px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, .62);
  color: var(--color-text-secondary);
  font-size: var(--type-size-micro);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  pointer-events: none;
}

.zoom-field {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 44px;
  align-items: center;
  gap: 8px;
}

.zoom-field span,
.zoom-field em {
  color: var(--color-text-secondary);
  font-size: var(--type-size-caption);
  font-style: normal;
}

.zoom-field input {
  width: 100%;
  min-height: 28px;
  padding: 0;
  accent-color: var(--color-brand);
}

.crop-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.crop-actions button {
  min-height: 38px;
  border: none;
  border-radius: var(--radius-control);
  font: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}

.crop-cancel {
  background: var(--surface-control);
  color: var(--color-text-secondary);
}

.crop-confirm {
  background: var(--color-brand);
  color: var(--color-text-inverse);
}

.strength-field {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 38px;
  align-items: center;
  gap: 8px;
  padding: 0;
  background: transparent;
}

.strength-field span,
.strength-field em { font-size: var(--type-size-caption); font-style: normal; }
.strength-field em { color: var(--color-text-secondary); text-align: right; }
.strength-field input { width: 100%; min-height: 28px; padding: 0; accent-color: var(--color-brand); }
.appearance-message { margin: 0; color: var(--color-text-secondary); font-size: var(--type-size-caption); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
