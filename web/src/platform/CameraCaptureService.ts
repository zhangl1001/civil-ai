import { Capacitor, registerPlugin } from '@capacitor/core';

export type CameraPermissionStatus = 'granted' | 'prompt' | 'denied' | 'restricted' | 'unknown';

interface NativeCameraPlugin {
  getPermission(): Promise<{ status: CameraPermissionStatus }>;
  capturePhoto(): Promise<{
    cancelled: boolean;
    dataBase64?: string;
    mimeType?: string;
    fileName?: string;
    width?: number;
    height?: number;
  }>;
  openAppSettings(): Promise<{ opened: boolean }>;
}

const nativeCamera = registerPlugin<NativeCameraPlugin>('NativeCamera');
const CAMERA_PERMISSION_CODES = new Set(['CAMERA_PERMISSION_DENIED', 'CAMERA_PERMISSION_RESTRICTED']);
const MAX_CAPTURE_BASE64_CHARS = 9 * 1024 * 1024;

export class CameraPermissionError extends Error {
  readonly name = 'CameraPermissionError';

  constructor(readonly permissionStatus: 'denied' | 'restricted') {
    super(permissionStatus === 'restricted' ? '相机权限受到系统限制。' : '相机权限未开启。');
  }
}

export class CameraCaptureService {
  isNativeCameraAvailable(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  }

  async getPermission(): Promise<CameraPermissionStatus> {
    if (!this.isNativeCameraAvailable()) return 'unknown';
    try {
      return (await nativeCamera.getPermission()).status;
    } catch {
      return 'unknown';
    }
  }

  async capturePhoto(): Promise<File | undefined> {
    if (!this.isNativeCameraAvailable()) throw new Error('拍照导入目前仅支持 iPhone 真机。');
    try {
      const result = await nativeCamera.capturePhoto();
      if (result.cancelled) return undefined;
      const encoded = result.dataBase64 || '';
      if (!encoded || encoded.length > MAX_CAPTURE_BASE64_CHARS) {
        throw new Error('拍摄照片内容异常，请重新拍摄。');
      }
      const mimeType = result.mimeType || 'image/jpeg';
      return new File(
        [decodeBase64(encoded)],
        result.fileName || `真题拍照-${Date.now()}.jpg`,
        { type: mimeType, lastModified: Date.now() }
      );
    } catch (cause) {
      const code = nativeErrorCode(cause);
      if (CAMERA_PERMISSION_CODES.has(code)) {
        throw new CameraPermissionError(code === 'CAMERA_PERMISSION_RESTRICTED' ? 'restricted' : 'denied');
      }
      throw cause instanceof Error ? cause : new Error('打开相机失败，请稍后重试。');
    }
  }

  async openAppSettings(): Promise<void> {
    if (!this.isNativeCameraAvailable()) return;
    await nativeCamera.openAppSettings();
  }
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return buffer;
}

function nativeErrorCode(cause: unknown): string {
  if (!cause || typeof cause !== 'object') return '';
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

export const cameraCaptureService = new CameraCaptureService();
