#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const ipa = path.resolve(process.argv[2] || path.join(root, 'build/ios/vue-release/export/App.ipa'));
const vueSource = path.join(root, 'web/dist');

function fail(message) { console.error('verify-ios-ipa:', message); process.exit(1); }
if (!fs.existsSync(ipa)) fail(`missing IPA: ${ipa}`);

function walk(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(prefix, entry.name);
    return entry.isDirectory() ? walk(path.join(dir, entry.name), rel) : [rel.split(path.sep).join('/')];
  });
}

function archivedFile(file) {
  return spawnSync('unzip', ['-p', ipa, `Payload/App.app/public/${file}`], { encoding: null, maxBuffer: 16 * 1024 * 1024 });
}

function archivedAppFile(file) {
  return spawnSync('unzip', ['-p', ipa, `Payload/App.app/${file}`], { encoding: null, maxBuffer: 16 * 1024 * 1024 });
}

const archivedIndex = archivedFile('index.html');
if (archivedIndex.status !== 0) fail('missing public/index.html');

const indexText = Buffer.from(archivedIndex.stdout).toString('utf8');
if (!indexText.includes('./assets/')) fail('IPA does not contain the current Vue entrypoint');
if (!fs.existsSync(vueSource)) fail('missing Vue build directory');
const legacyProbe = archivedFile('legacy/index.html');
if (legacyProbe.status === 0) fail('IPA unexpectedly contains removed legacy assets');
const capacitorConfig = archivedAppFile('capacitor.config.json');
if (capacitorConfig.status !== 0) fail('missing capacitor.config.json');
let parsedConfig;
try {
  parsedConfig = JSON.parse(Buffer.from(capacitorConfig.stdout).toString('utf8'));
} catch (error) {
  fail(`invalid capacitor.config.json: ${error.message}`);
}
if (!Array.isArray(parsedConfig.packageClassList) || !parsedConfig.packageClassList.includes('CapacitorSQLitePlugin')) {
  fail('IPA does not register CapacitorSQLitePlugin');
}

for (const file of walk(vueSource)) {
  const expected = fs.readFileSync(path.join(vueSource, file));
  const archived = archivedFile(file);
  if (archived.status !== 0) fail(`missing public/${file}`);
  if (!Buffer.from(archived.stdout).equals(expected)) fail(`source mismatch: ${file}`);
}

console.log(`IPA resources verified (${path.relative(root, vueSource)}): ${path.basename(ipa)}`);
