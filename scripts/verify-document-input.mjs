import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const webRoot = path.join(repositoryRoot, 'web');
const server = await createServer({
  root: webRoot,
  configFile: false,
  resolve: { alias: { '@': path.join(webRoot, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

try {
  const extraction = await server.ssrLoadModule('/src/platform/DocumentTextExtractionService.ts');
  assert.doesNotMatch(extraction.DOCUMENT_FILE_IMPORT_ACCEPT, /image\/\*/);
  assert.match(extraction.DOCUMENT_FILE_IMPORT_ACCEPT, /application\/pdf/);
  const textFile = new File(['# 标题\r\n\r\n正文'], 'sample.md', { type: 'text/markdown' });
  const textResult = await extraction.documentTextExtractionService.extract(textFile);
  assert.equal(textResult.method, 'plain_text');
  assert.equal(textResult.text, '# 标题\n\n正文');
  await assert.rejects(
    () => extraction.documentTextExtractionService.extract(
      new File(['image'], 'sample.png', { type: 'image/png' })
    ),
    /仅支持 iPhone 真机/
  );
  await assert.rejects(
    () => extraction.documentTextExtractionService.extract(new File(['image'], 'camera.heic')),
    /仅支持 iPhone 真机/
  );

  const reader = await server.ssrLoadModule('/src/services/AgentFileChunk.ts');
  const source = 'A'.repeat(30_000);
  const first = reader.createAgentFileChunk('导入资料/demo.md', source, {});
  assert.match(first.content, /0-16000 \/ 30000/);
  assert.match(first.content, /offset=16000/);
  const second = reader.createAgentFileChunk('导入资料/demo.md', source, { offset: 16_000 });
  assert.match(second.content, /16000-30000 \/ 30000/);
  assert.match(second.content, /文件末尾/);

  const [swift, cameraSwift, controller, project, infoPlist, chat, attachmentSource, extractionSource, cameraSource, catalog] = await Promise.all([
    read('ios/App/App/NativeDocumentTextPlugin.swift'),
    read('ios/App/App/NativeCameraPlugin.swift'),
    read('ios/App/App/MainViewController.swift'),
    read('ios/App/App.xcodeproj/project.pbxproj'),
    read('ios/App/App/Info.plist'),
    read('web/src/components/AIChatSheet.vue'),
    read('web/src/services/ChatAttachmentService.ts'),
    read('web/src/platform/DocumentTextExtractionService.ts'),
    read('web/src/platform/CameraCaptureService.ts'),
    read('web/src/modules/agent/fixtures/tutorToolCatalog.ts')
  ]);
  assert.match(swift, /import PDFKit/);
  assert.match(swift, /import Vision/);
  assert.match(swift, /recognitionLevel = \.accurate/);
  assert.match(controller, /registerPluginInstance\(NativeDocumentTextPlugin\(\)\)/);
  assert.match(controller, /registerPluginInstance\(NativeCameraPlugin\(\)\)/);
  assert.match(project, /NativeDocumentTextPlugin\.swift in Sources/);
  assert.match(project, /NativeCameraPlugin\.swift in Sources/);
  assert.match(infoPlist, /<key>NSCameraUsageDescription<\/key>/);
  assert.match(infoPlist, /<key>NSPhotoLibraryUsageDescription<\/key>/);
  assert.match(cameraSwift, /AVCaptureDevice\.requestAccess\(for: \.video\)/);
  assert.match(cameraSwift, /CAMERA_PERMISSION_DENIED/);
  assert.match(cameraSwift, /UIApplication\.openSettingsURLString/);
  assert.match(cameraSwift, /maximumImageEdge: CGFloat = 2_048/);
  assert.match(cameraSource, /CameraPermissionError/);
  assert.match(cameraSource, /openAppSettings/);
  assert.match(chat, /:accept="DOCUMENT_IMPORT_ACCEPT"/);
  assert.match(attachmentSource, /extractImageFallback\(file\)/);
  assert.match(attachmentSource, /documentTextExtractionService\.extract\(file\)/);
  assert.match(attachmentSource, /imageParts\.push\(await prepareVisionImage\(file\)\)/);
  assert.match(attachmentSource, /本地文字识别未完成/);
  assert.match(extractionSource, /application\/pdf,image\/\*/);
  assert.match(extractionSource, /canExtractImageLocally\(\)/);
  assert.match(catalog, /maxChars: \{ type: 'number', minimum: 2_000, maximum: 24_000 \}/);

  console.log('Document input verification passed.');
} finally {
  await server.close();
}

async function read(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}
