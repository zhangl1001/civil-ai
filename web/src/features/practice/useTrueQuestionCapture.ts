import { ref, type Ref } from 'vue';
import { CameraPermissionError, cameraCaptureService } from '@/platform/CameraCaptureService';

const DENIED_HINT = '请在系统设置中允许访问相机，然后返回继续拍摄真题。';
const RESTRICTED_HINT = '相机权限受到系统或家长控制限制，请检查系统设置后再试。';

interface TrueQuestionCaptureOptions {
  readonly onCaptured: (files: readonly File[]) => void;
  readonly onError: (message: string) => void;
  /** Lets a caller block capture while its own import is still running. */
  readonly isBusy?: () => boolean;
}

export interface TrueQuestionCapture {
  readonly nativeCameraAvailable: boolean;
  readonly takingPhoto: Readonly<Ref<boolean>>;
  readonly permissionDescription: Readonly<Ref<string>>;
  /** Bound with v-model, so the dialog stays writable for the consumer. */
  readonly showPermissionDialog: Ref<boolean>;
  capturePhoto(): Promise<void>;
  openCameraSettings(): Promise<void>;
}

/**
 * Owns camera capture and its permission recovery so every 真题导入 surface behaves
 * identically; callers only decide what to do with the captured file.
 */
export function useTrueQuestionCapture(options: TrueQuestionCaptureOptions): TrueQuestionCapture {
  const takingPhoto = ref(false);
  const showPermissionDialog = ref(false);
  const permissionDescription = ref(DENIED_HINT);

  async function capturePhoto() {
    if (takingPhoto.value || options.isBusy?.()) return;
    takingPhoto.value = true;
    try {
      const file = await cameraCaptureService.capturePhoto();
      if (file) options.onCaptured([file]);
    } catch (cause) {
      if (cause instanceof CameraPermissionError) {
        permissionDescription.value = cause.permissionStatus === 'restricted' ? RESTRICTED_HINT : DENIED_HINT;
        showPermissionDialog.value = true;
        return;
      }
      options.onError(cause instanceof Error ? cause.message : '打开相机失败，请稍后重试。');
    } finally {
      takingPhoto.value = false;
    }
  }

  async function openCameraSettings() {
    showPermissionDialog.value = false;
    try {
      await cameraCaptureService.openAppSettings();
    } catch (cause) {
      options.onError(cause instanceof Error ? cause.message : '无法打开系统设置。');
    }
  }

  return {
    nativeCameraAvailable: cameraCaptureService.isNativeCameraAvailable(),
    takingPhoto,
    permissionDescription,
    showPermissionDialog,
    capturePhoto,
    openCameraSettings
  };
}
