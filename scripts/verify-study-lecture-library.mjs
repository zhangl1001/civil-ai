import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [service, view, executor] = await Promise.all([
  read('web/src/services/StudyService.ts'),
  read('web/src/views/StudyView.vue'),
  read('web/src/composition-root/agent/BusinessAgentExecutors.ts')
]);

assert.match(service, /async listLectures\(limit = 20\)/);
assert.match(service, /kinds: \[LearningAssetKind\.StudyLecture\]/);
assert.match(service, /status: LearningAssetStatus\.Ready/);
assert.match(service, /seen\.has\(asset\.businessKey\)/);
assert.match(view, />我的讲义</);
assert.match(view, /studyService\.listLectures\(\)/);
assert.match(view, /query: \{ assetId \}/);
assert.match(view, /watch\(\(\) => \[route\.query\.assetId, route\.query\.dailyPlanItemId, route\.query\.start\], load, \{ immediate: true \}\)/);
assert.match(view, /studyService\.startDailyPlanLecture/);
assert.match(view, /studyService\.completeDailyPlanLecture/);
assert.match(executor, /kind: LearningAssetKind\.StudyLecture/);
assert.match(executor, /payload: \{ module, topic, content:/);

console.log('Study lecture library verification passed.');

function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}
