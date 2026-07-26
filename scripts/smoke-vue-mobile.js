import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function source(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert.ok(existsSync(absolutePath), `Missing required file: ${relativePath}`);
  return readFileSync(absolutePath, 'utf8');
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const item = path.join(directory, entry.name);
    return entry.isDirectory() ? files(item) : [item];
  });
}

const requiredFiles = [
  'web/dist/index.html',
  'web/src/composition-root/database/createTutorDatabaseRuntime.ts',
  'web/src/composition-root/database/createNativeTutorDatabase.ts',
  'web/src/composition-root/database/createWebTutorDatabase.ts',
  'web/src/capabilities/database/contracts/TutorDataMaintenance.ts',
  'web/src/modules/content/domain/LearningAssetCodes.ts',
  'web/src/modules/agent/application/RunAgentLoop.ts',
  'web/src/features/practice/TutorPracticeSessionView.vue',
  'web/src/features/planning/TutorPlanView.vue',
  'web/src/features/wrongbook/TutorWrongBookView.vue',
  'web/src/components/AIChatSheet.vue',
  'web/src/components/TaskDock.vue',
  'web/src/components/TaskToast.vue',
  'web/src/components/MarkdownContent.vue',
  'web/src/capabilities/design-system/public.ts'
];
requiredFiles.forEach(source);

const routes = source('web/src/router/index.ts');
[
  "path: '/vue'",
  '/vue/study',
  '/vue/practice',
  '/vue/practice/objective-session',
  '/vue/essay',
  '/vue/wrongbook',
  '/vue/plan',
  '/vue/digest',
  '/vue/monthly-digest',
  '/vue/interview',
  '/vue/quality-dashboard'
].forEach((route) => assert.match(routes, new RegExp(route.replaceAll('/', '\\/')), `Missing route ${route}`));

const databaseRuntime = source('web/src/composition-root/database/createTutorDatabaseRuntime.ts');
assert.match(databaseRuntime, /Capacitor\.isNativePlatform\(\)/);
assert.match(databaseRuntime, /createNativeTutorDatabase/);
assert.match(databaseRuntime, /createWebTutorDatabase/);

const srcRoot = path.join(root, 'web/src');
const sourceFiles = files(srcRoot).filter((file) => /\.(ts|vue)$/.test(file));
for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /@\/db\/(?:database|migrations|schema)/, `Legacy database import remains in ${file}`);
  assert.doesNotMatch(text, /PracticeSessionRepository|QuestionRepository|ProfileAnalysisRepository/, `Legacy repository reference remains in ${file}`);
}

const distAssets = path.join(root, 'web/dist/assets');
assert.ok(existsSync(distAssets), 'Vite assets directory is missing');
assert.ok(files(distAssets).some((file) => statSync(file).size > 0), 'Vite output assets are empty');

console.log('Vue mobile smoke verification passed.');
