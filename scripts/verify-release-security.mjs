import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [
  path.join(repositoryRoot, 'ios'),
  path.join(repositoryRoot, 'scripts')
];
const excludedDirectories = new Set(['build', 'DerivedData', 'node_modules', 'public']);
const privateKeyPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const findings = [];

for (const root of roots) {
  for (const file of await filesUnder(root)) {
    const content = await readFile(file, 'utf8').catch(() => '');
    if (privateKeyPattern.test(content)) {
      findings.push(path.relative(repositoryRoot, file));
    }
  }
}

assert.deepEqual(
  findings,
  [],
  `Release security check failed: private key material found in ${findings.join(', ')}`
);

const nativeStreamingSource = await readFile(
  path.join(repositoryRoot, 'ios/App/App/NativeStreamingHTTPPlugin.swift'),
  'utf8'
);
for (const requiredBoundary of [
  'NativeNetworkTargetPolicy.validate(url)',
  'purpose == .model ? "POST" : "GET"',
  'maximumConcurrentStreams',
  'maximumRequestBodyBytes',
  'maximumResponseBytes',
  'maximumDataEvents',
  'maximumPendingEvents',
  'willPerformHTTPRedirection',
  'context.purpose == .model, redirectHost != context.originalHost',
  'context.purpose == .publicWeb, redirectHost != context.originalHost',
  'sensitiveHeaders',
  'getaddrinfo(host',
  'isPublicIPv4',
  'isPublicIPv6',
  'allowedHeaders'
]) {
  assert.ok(
    nativeStreamingSource.includes(requiredBoundary),
    `Release security check failed: NativeStreamingHTTP is missing ${requiredBoundary}`
  );
}
assert.ok(
  !nativeStreamingSource.includes('call.getObject("headers")?.forEach'),
  'Release security check failed: NativeStreamingHTTP forwards arbitrary request headers'
);

const documentTextSource = await readFile(
  path.join(repositoryRoot, 'ios/App/App/NativeDocumentTextPlugin.swift'),
  'utf8'
);
const encodedLimitIndex = documentTextSource.indexOf('encoded.utf8.count <= maximumEncodedCharacters');
const base64DecodeIndex = documentTextSource.indexOf('Data(base64Encoded: encoded)');
assert.ok(
  encodedLimitIndex >= 0 && base64DecodeIndex > encodedLimitIndex,
  'Release security check failed: document input must be size-checked before Base64 decoding'
);
for (const requiredBoundary of [
  'maximumImagePixels',
  'maximumExtractionSeconds',
  'CGImageSourceCreateThumbnailAtIndex',
  'assertWithinDeadline'
]) {
  assert.ok(
    documentTextSource.includes(requiredBoundary),
    `Release security check failed: NativeDocumentText is missing ${requiredBoundary}`
  );
}

const workspaceSource = await readFile(
  path.join(repositoryRoot, 'ios/App/App/NativeAgentWorkspacePlugin.swift'),
  'utf8'
);
for (const requiredBoundary of [
  'maximumKeyBytes',
  'maximumLineBytes',
  'maximumFileBytes',
  'maximumFileCount',
  'maximumWorkspaceBytes',
  'workspaceState(for:'
]) {
  assert.ok(
    workspaceSource.includes(requiredBoundary),
    `Release security check failed: NativeAgentWorkspace is missing ${requiredBoundary}`
  );
}

const speechSource = await readFile(
  path.join(repositoryRoot, 'ios/App/App/SpeechRecognitionPlugin.swift'),
  'utf8'
);
for (const requiredBoundary of [
  'UIApplication.didEnterBackgroundNotification',
  'teardownRecognition()',
  'recognitionRequest?.endAudio()',
  'recognitionTask?.cancel()',
  'setActive(false'
]) {
  assert.ok(
    speechSource.includes(requiredBoundary),
    `Release security check failed: SpeechRecognition is missing ${requiredBoundary}`
  );
}

const privacyManifest = await readFile(
  path.join(repositoryRoot, 'ios/App/App/PrivacyInfo.xcprivacy'),
  'utf8'
);
for (const requiredPrivacyEntry of [
  'NSPrivacyAccessedAPICategoryUserDefaults',
  'CA92.1',
  'NSPrivacyAccessedAPICategoryFileTimestamp',
  'C617.1'
]) {
  assert.ok(
    privacyManifest.includes(requiredPrivacyEntry),
    `Release security check failed: PrivacyInfo.xcprivacy is missing ${requiredPrivacyEntry}`
  );
}

const xcodeProject = await readFile(
  path.join(repositoryRoot, 'ios/App/App.xcodeproj/project.pbxproj'),
  'utf8'
);
assert.ok(
  xcodeProject.includes('PrivacyInfo.xcprivacy in Resources'),
  'Release security check failed: PrivacyInfo.xcprivacy is not in the App resource phase'
);

const archiveScript = await readFile(
  path.join(repositoryRoot, 'scripts/archive-ios-web.sh'),
  'utf8'
);
assert.ok(
  archiveScript.includes('ios/export-options/Development.plist'),
  'Release security check failed: archive script does not use the tracked development export configuration'
);
assert.ok(
  !archiveScript.includes('build/ios/ExportOptions.plist'),
  'Release security check failed: archive script still relies on an ignored export configuration'
);

const capacitorPackage = await readFile(
  path.join(repositoryRoot, 'ios/App/CapApp-SPM/Package.swift'),
  'utf8'
);
const sqlitePatch = await readFile(
  path.join(repositoryRoot, 'patches/@capacitor-community+sqlite+8.1.0.patch'),
  'utf8'
);
const swiftPackageLock = JSON.parse(await readFile(
  path.join(repositoryRoot, 'ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'),
  'utf8'
));
assert.ok(
  capacitorPackage.includes('exact: "8.4.1"'),
  'Release security check failed: CapApp-SPM must pin capacitor-swift-pm 8.4.1'
);
assert.ok(
  sqlitePatch.includes('from: "8.0.0"') && !sqlitePatch.includes('+        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", branch: "8.0.0")'),
  'Release security check failed: SQLite SwiftPM compatibility patch is missing'
);
const capacitorPin = swiftPackageLock.pins.find((pin) => pin.identity === 'capacitor-swift-pm');
assert.equal(
  capacitorPin?.state?.version,
  '8.4.1',
  'Release security check failed: SwiftPM lock does not resolve capacitor-swift-pm 8.4.1'
);
console.log('Release security verification passed.');

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) return [];
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  }));
  return nested.flat();
}
