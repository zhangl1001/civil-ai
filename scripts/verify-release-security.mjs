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
  'method == "POST"',
  'maximumConcurrentStreams',
  'maximumRequestBodyBytes',
  'maximumResponseBytes',
  'maximumDataEvents',
  'maximumPendingEvents',
  'willPerformHTTPRedirection',
  'redirectHost == context.originalHost',
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
