import { Capacitor, registerPlugin } from '@capacitor/core';

export type DocumentExtractionMethod = 'plain_text' | 'pdf_text' | 'pdf_ocr' | 'image_ocr' | 'image_vision' | 'mixed';

export interface DocumentExtractionResult {
  readonly text: string;
  readonly method: DocumentExtractionMethod;
  readonly pageCount: number;
  readonly warnings: readonly string[];
}

interface NativeDocumentTextPlugin {
  extract(input: {
    dataBase64: string;
    fileName: string;
    mimeType: string;
  }): Promise<{
    text: string;
    method: DocumentExtractionMethod;
    pageCount?: number;
    warnings?: string[];
  }>;
}

const nativeDocumentText = registerPlugin<NativeDocumentTextPlugin>('NativeDocumentText');
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 500_000;
const PLAIN_TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'json', 'csv']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'tif', 'tiff', 'bmp']);

export const DOCUMENT_IMPORT_ACCEPT = '.txt,.md,.markdown,.json,.csv,.pdf,text/*,application/json,application/pdf,image/*';

export class DocumentTextExtractionService {
  async extract(file: File): Promise<DocumentExtractionResult> {
    assertSupportedSize(file);
    const kind = documentKind(file);
    if (kind === 'text') return extractPlainText(file);
    if (Capacitor.isNativePlatform()) return extractNative(file);
    if (kind === 'pdf') return extractPdfInBrowser(file);
    throw new Error('图片文字识别目前仅支持 iPhone 真机；网页端请导入 PDF 或文本文件。');
  }
}

async function extractPlainText(file: File): Promise<DocumentExtractionResult> {
  const text = normalizeExtractedText(await file.text());
  assertHasText(text);
  return {
    text: limitText(text),
    method: 'plain_text',
    pageCount: 1,
    warnings: text.length > MAX_TEXT_CHARS ? ['文件较长，已保留前 50 万字。'] : []
  };
}

async function extractNative(file: File): Promise<DocumentExtractionResult> {
  const sourceFile = documentKind(file) === 'image' ? await prepareImageForNativeOcr(file) : file;
  const result = await nativeDocumentText.extract({
    dataBase64: await fileToBase64(sourceFile),
    fileName: sourceFile.name,
    mimeType: normalizedMimeType(sourceFile)
  });
  const text = normalizeExtractedText(result.text);
  assertHasText(text);
  return {
    text: limitText(text),
    method: result.method,
    pageCount: Math.max(1, Number(result.pageCount) || 1),
    warnings: [
      ...(result.warnings || []),
      ...(text.length > MAX_TEXT_CHARS ? ['文件较长，已保留前 50 万字。'] : [])
    ]
  };
}

const MAX_NATIVE_OCR_IMAGE_EDGE = 2_400;

async function prepareImageForNativeOcr(file: File): Promise<File> {
  if (typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_NATIVE_OCR_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .86));
    if (!blob) return file;
    const stem = file.name.replace(/\.[^.]+$/, '') || 'capture';
    return new File([blob], `${stem}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    // Some iOS versions cannot decode HEIC through ImageBitmap; native OCR
    // still receives the original and returns a recoverable error.
    return file;
  } finally {
    bitmap?.close();
  }
}

async function extractPdfInBrowser(file: File): Promise<DocumentExtractionResult> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  const pages: string[] = [];
  try {
    for (let index = 1; index <= pageCount; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .trim();
      if (text) pages.push(`## 第 ${index} 页\n\n${text}`);
    }
  } finally {
    await document.destroy();
  }
  const text = normalizeExtractedText(pages.join('\n\n'));
  assertHasText(text, 'PDF 没有可读取的文本层；请在 iPhone 真机导入，由系统 OCR 识别。');
  return {
    text: limitText(text),
    method: 'pdf_text',
    pageCount,
    warnings: text.length > MAX_TEXT_CHARS ? ['文件较长，已保留前 50 万字。'] : []
  };
}

function documentKind(file: File): 'text' | 'pdf' | 'image' {
  const mimeType = normalizedMimeType(file);
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (mimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || PLAIN_TEXT_EXTENSIONS.has(extension)) {
    return 'text';
  }
  throw new Error('仅支持 PDF、图片、Markdown、JSON、CSV 和纯文本文件。');
}

function normalizedMimeType(file: File): string {
  const explicit = file.type.trim().toLowerCase();
  if (explicit) return explicit;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'json') return 'application/json';
  if (IMAGE_EXTENSIONS.has(extension || '')) return `image/${extension === 'jpg' ? 'jpeg' : extension}`;
  if (PLAIN_TEXT_EXTENSIONS.has(extension || '')) return 'text/plain';
  return 'application/octet-stream';
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function assertSupportedSize(file: File): void {
  if (file.size <= 0) throw new Error('文件内容为空。');
  if (file.size > MAX_FILE_BYTES) throw new Error('文件不能超过 25 MB。');
}

function assertHasText(text: string, message = '没有识别到可读取的文字。'): void {
  if (!text) throw new Error(message);
}

function limitText(text: string): string {
  return text.slice(0, MAX_TEXT_CHARS);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('文件读取失败。'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const separator = dataUrl.indexOf(',');
      if (separator < 0) reject(new Error('文件编码失败。'));
      else resolve(dataUrl.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

export const documentTextExtractionService = new DocumentTextExtractionService();
