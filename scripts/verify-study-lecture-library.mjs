import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [service, view, executor, prioritySnapshot] = await Promise.all([
  read('web/src/services/StudyService.ts'),
  read('web/src/views/StudyView.vue'),
  read('web/src/composition-root/agent/BusinessAgentExecutors.ts'),
  read('web/src/modules/tutoring/application/BuildLearnerPrioritySnapshot.ts')
]);

assert.match(service, /async listLectures\(limit = 20\)/);
assert.match(service, /kinds: \[LearningAssetKind\.StudyLecture\]/);
assert.match(service, /status: LearningAssetStatus\.Ready/);
assert.match(service, /seen\.has\(asset\.businessKey\)/);
assert.match(view, /title="我的讲义"/);
assert.match(view, /studyService\.listLectures\(\)/);
assert.match(view, /openLecture\(lecture\.id, lecture\.capabilityNodeId\)/);
assert.match(view, /query: \{ assetId, \.\.\.\(capabilityNodeId/);
assert.match(view, /route\.query\.taskId/);
assert.match(view, /studyService\.startDailyPlanLecture/);
assert.match(view, /studyService\.markLectureStarted/);
assert.match(view, /studyService\.completeLecture/);
assert.match(service, /buildLearnerPrioritySnapshot\.execute/);
assert.match(prioritySnapshot, /this\.progress\.listByCycle/);
assert.match(prioritySnapshot, /learningStatus/);
assert.match(service, /trackLearningProgress\.complete/);
assert.match(executor, /kind: LearningAssetKind\.StudyLecture/);
assert.match(executor, /capabilityNodeId/);

console.log('Study lecture library verification passed.');

function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}
