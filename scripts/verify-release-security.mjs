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
