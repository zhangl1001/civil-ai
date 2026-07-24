import { settingsService } from './SettingsService';

export type ThemePresetId = 'study-light' | 'quiet-jade' | 'soft-rose';

export interface ThemeSettings {
  preset: ThemePresetId;
  backgroundImage: string | null;
  backgroundStrength: number;
  updatedAt: number;
}

export const THEME_PRESETS: Array<{ id: ThemePresetId; name: string; description: string }> = [
  { id: 'study-light', name: '清朗蓝', description: '清晰、平衡' },
  { id: 'quiet-jade', name: '静心青', description: '安静、耐看' },
  { id: 'soft-rose', name: '柔雾红', description: '柔和、温暖' }
];

const SETTINGS_KEY = 'appearance:theme:v1';
const DEFAULT_SETTINGS: ThemeSettings = {
  preset: 'study-light',
  backgroundImage: null,
  backgroundStrength: 46,
  updatedAt: 0
};

function normalizeSettings(value?: Partial<ThemeSettings> | null): ThemeSettings {
  const preset = THEME_PRESETS.some((item) => item.id === value?.preset)
    ? value!.preset as ThemePresetId
    : DEFAULT_SETTINGS.preset;
  const backgroundStrength = Math.min(85, Math.max(20, Number(value?.backgroundStrength) || DEFAULT_SETTINGS.backgroundStrength));
  return {
    preset,
    backgroundImage: typeof value?.backgroundImage === 'string' && value.backgroundImage.startsWith('data:image/')
      ? value.backgroundImage
      : null,
    backgroundStrength,
    updatedAt: Number(value?.updatedAt) || 0
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片格式无法识别'));
    image.src = source;
  });
}

function isImageDataUrl(value: string): boolean {
  return value.startsWith('data:image/');
}

async function compressBackground(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > 16 * 1024 * 1024) throw new Error('图片不能超过 16 MB');
  const source = await fileToDataUrl(file);
  const image = await loadImage(source);
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前设备无法处理图片');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', .82);
}

export class ThemeService {
  private current: ThemeSettings = { ...DEFAULT_SETTINGS };

  async initialize(): Promise<ThemeSettings> {
    this.current = normalizeSettings(await settingsService.get<ThemeSettings | null>(SETTINGS_KEY, null));
    this.apply(this.current);
    return { ...this.current };
  }

  getCurrent(): ThemeSettings {
    return { ...this.current };
  }

  async setPreset(preset: ThemePresetId): Promise<ThemeSettings> {
    return this.save({ preset });
  }

  async setBackgroundStrength(backgroundStrength: number): Promise<ThemeSettings> {
    return this.save({ backgroundStrength });
  }

  async setCustomBackground(file: File): Promise<ThemeSettings> {
    const backgroundImage = await compressBackground(file);
    return this.save({ backgroundImage });
  }

  async setCustomBackgroundDataUrl(backgroundImage: string): Promise<ThemeSettings> {
    if (!isImageDataUrl(backgroundImage)) throw new Error('图片裁切结果无效');
    return this.save({ backgroundImage });
  }

  async clearCustomBackground(): Promise<ThemeSettings> {
    return this.save({ backgroundImage: null });
  }

  private async save(patch: Partial<ThemeSettings>): Promise<ThemeSettings> {
    this.current = normalizeSettings({ ...this.current, ...patch, updatedAt: Date.now() });
    await settingsService.set(SETTINGS_KEY, this.current);
    this.apply(this.current);
    return { ...this.current };
  }

  private apply(settings: ThemeSettings): void {
    const root = document.documentElement;
    root.dataset.theme = settings.preset;
    if (settings.backgroundImage) {
      root.style.setProperty('--theme-background-image', `url(${settings.backgroundImage})`);
      root.style.setProperty('--theme-background-image-opacity', String(settings.backgroundStrength / 100));
      root.style.setProperty('--theme-background-scrim', 'rgba(248, 250, 253, .3)');
      root.style.setProperty('--theme-grid-opacity', '.12');
    } else {
      root.style.removeProperty('--theme-background-image');
      root.style.setProperty('--theme-background-image-opacity', '0');
      root.style.setProperty('--theme-background-scrim', 'transparent');
      root.style.removeProperty('--theme-grid-opacity');
    }
    window.dispatchEvent(new CustomEvent('zhangl-webview-repaint'));
  }
}

export const themeService = new ThemeService();
