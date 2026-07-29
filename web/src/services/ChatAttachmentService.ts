import {
  documentTextExtractionService,
  type DocumentExtractionMethod,
  type DocumentExtractionResult
} from '@/platform/DocumentTextExtractionService';
import type { ModelImageContentPart } from '@/capabilities/ai-runtime/public';
import { fileRepository } from './FileRepository';
import { projectRepository } from './ProjectRepository';

export interface ImportedChatAttachment {
  readonly name: string;
  readonly path: string;
  readonly method: DocumentExtractionMethod;
  readonly pageCount: number;
  readonly fileCount?: number;
  /** Ephemeral multimodal parts. They are sent for this run and never persisted. */
  readonly imageParts?: readonly ModelImageContentPart[];
}

export class ChatAttachmentService {
  async import(file: File): Promise<ImportedChatAttachment> {
    return this.importMany([file]);
  }

  async importMany(files: readonly File[]): Promise<ImportedChatAttachment> {
    assertAttachmentBatch(files);
    const extractedFiles: Array<{ file: File; extraction: DocumentExtractionResult }> = [];
    const imageParts: ModelImageContentPart[] = [];
    // Keep the original image for vision models and extract bounded OCR text on
    // iOS as a fallback for text-only models. Work remains sequential so a
    // multi-photo import does not decode several full-size images at once.
    for (const file of files) {
      if (isImageFile(file)) {
        const extraction = await extractImageFallback(file);
        imageParts.push(await prepareVisionImage(file));
        if (imageParts.reduce((total, part) => total + part.dataBase64.length, 0) > MAX_VISION_BATCH_ENCODED_CHARS) {
          throw new Error('本次图片内容过大，请分成两次导入，避免 iPhone 内存不足。');
        }
        extractedFiles.push({ file, extraction });
      } else {
        extractedFiles.push({ file, extraction: await documentTextExtractionService.extract(file) });
      }
    }
    const project = await projectRepository.getActiveProject();
    const firstName = files[0]?.name || '真题图片';
    const safeName = `${firstName}${files.length > 1 ? `-等${files.length}份` : ''}`.replace(/[/:\\]/g, '_');
    const path = `导入资料/${Date.now()}-${safeName}.extracted.md`;
    await fileRepository.writeText(project.id, path, extractedDocument(extractedFiles));
    const methods = new Set(extractedFiles.map(({ extraction }) => extraction.method));
    return {
      name: files.length > 1 ? `${firstName} 等 ${files.length} 个文件` : firstName,
      path,
      method: methods.size === 1 ? [...methods][0]! : 'mixed',
      pageCount: extractedFiles.reduce((total, item) => total + item.extraction.pageCount, 0),
      fileCount: files.length,
      ...(imageParts.length ? { imageParts } : {})
    };
  }
}

async function extractImageFallback(file: File): Promise<DocumentExtractionResult> {
  if (!documentTextExtractionService.canExtractImageLocally()) {
    return visionOnlyExtraction();
  }
  try {
    return await documentTextExtractionService.extract(file);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : '没有识别到文字';
    return {
      ...visionOnlyExtraction(),
      warnings: [`本地文字识别未完成：${reason}。将继续尝试由当前模型理解原图。`]
    };
  }
}

function visionOnlyExtraction(): DocumentExtractionResult {
  return {
    text: '当前没有本地 OCR 正文；原图已作为临时多模态附件提供。若模型不支持图片，请改用支持视觉输入的模型或导入可复制文本。',
    method: 'image_vision',
    pageCount: 1,
    warnings: []
  };
}

function extractedDocument(items: readonly { file: File; extraction: DocumentExtractionResult }[]): string {
  return [
    '# 导入资料',
    '',
    ...items.flatMap(({ file, extraction }) => [
      `## 原文件：${file.name}`,
      '',
      `- 提取方式：${extraction.method}`,
      `- 页数：${extraction.pageCount}`,
      ...(extraction.warnings.length ? [`- 提示：${extraction.warnings.join('；')}`] : []),
      '',
      extraction.text,
      '',
      '---',
      ''
    ])
  ].join('\n');
}

function assertAttachmentBatch(files: readonly File[]): void {
  if (!files.length) throw new Error('请至少选择一张图片或一个文件。');
  if (files.length > 12) throw new Error('一次最多导入 12 个文件。');
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > 60 * 1024 * 1024) throw new Error('本次导入文件总大小不能超过 60 MB。');
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'tif', 'tiff', 'bmp']);
const MAX_VISION_IMAGE_EDGE = 2_048;
const MAX_VISION_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_VISION_BATCH_ENCODED_CHARS = 18 * 1024 * 1024;

function isImageFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  return file.type.toLowerCase().startsWith('image/') || IMAGE_EXTENSIONS.has(extension);
}

async function prepareVisionImage(file: File): Promise<ModelImageContentPart> {
  let source: File = file;
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_VISION_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法准备图片画布。');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToBlob(canvas, 'image/jpeg', .84);
      if (!blob) throw new Error('图片压缩失败。');
      source = new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'question'}.jpg`, {
        type: 'image/jpeg',
        lastModified: file.lastModified
      });
    } catch (error) {
      const type = file.type.toLowerCase();
      if (type.includes('heic') || type.includes('heif')) {
        throw new Error('当前设备无法解码这张 HEIC 图片，请改用系统截图或 JPEG/PNG 导入。');
      }
      if (error instanceof Error) throw error;
    } finally {
      bitmap?.close();
    }
  }
  if (source.size > MAX_VISION_IMAGE_BYTES) {
    throw new Error(`图片“${file.name}”压缩后仍超过 6 MB，请裁剪后再导入。`);
  }
  return {
    type: 'image',
    mediaType: source.type || 'image/jpeg',
    dataBase64: await fileToBase64(source),
    attachmentId: `import:${crypto.randomUUID()}`,
    name: file.name
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('图片读取失败。'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const separator = dataUrl.indexOf(',');
      if (separator < 0) reject(new Error('图片编码失败。'));
      else resolve(dataUrl.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

export const chatAttachmentService = new ChatAttachmentService();
