import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [service, view, executor, prioritySnapshot, identity, learningCenter] = await Promise.all([
  read('web/src/services/StudyService.ts'),
  read('web/src/views/StudyView.vue'),
  read('web/src/composition-root/agent/BusinessAgentExecutors.ts'),
  read('web/src/modules/tutoring/application/BuildLearnerPrioritySnapshot.ts'),
  read('web/src/domain/studyLecture.ts'),
  read('web/src/views/LearningCenterView.vue')
]);

assert.match(service, /async listLectures\(limit = 20\)/);
assert.match(service, /kinds: \[LearningAssetKind\.StudyLecture\]/);
assert.match(service, /status: LearningAssetStatus\.Ready/);
assert.match(service, /seen\.has\(asset\.businessKey\)/);
assert.match(service, /const module = practiceModuleLabel\(\s*payloadString\(asset\.payload\.moduleLabel\) \|\| sourceModule \|\| '公考'\s*\);/);
assert.match(service, /studyLectureDisplayTitle\(asset\.title, sourceModule, module\)/);
assert.match(view, /title="我的讲义"/);
assert.match(view, /practiceModuleLabel\(lecture\.module\)/);
assert.match(view, /studyService\.listLectures\(\)/);
assert.match(view, /openLecture\(lecture\.id, lecture\.capabilityNodeId\)/);
// Opening a stored lecture must keep both linkages, or completing it stops
// closing out the daily-plan item and stops crediting the capability.
assert.match(view, /query: \{\s*assetId,/);
assert.match(view, /dailyPlanItemId: dailyPlanItemId\.value/);
assert.match(view, /capabilityNodeId: capabilityNode\b/);
assert.match(view, /route\.query\.taskId/);
assert.match(view, /studyService\.startDailyPlanLecture/);
assert.match(view, /studyService\.markLectureStarted/);
assert.match(view, /studyService\.completeLecture/);
assert.match(service, /buildLearnerPrioritySnapshot\.execute/);
assert.match(prioritySnapshot, /this\.progress\.listByCycle/);
assert.match(prioritySnapshot, /learningStatus/);
assert.match(service, /trackLearningProgress\.complete/);
assert.match(executor, /kind: LearningAssetKind\.StudyLecture/);
assert.match(executor, /moduleLabel: module/);
assert.match(executor, /capabilityNodeId/);

// A lecture belongs to its knowledge point, so revisiting one reopens what was
// already written. Writer and reader must derive the same key from the shared
// helper: if they drift apart the lookup silently misses and every visit pays
// for a regeneration again.
assert.match(identity, /export function studyLectureBusinessKey\(moduleCode: string, topic: string\)/);
assert.match(identity, /return `study:\$\{normalizedModule\}:\$\{normalizedTopic\}`/);
assert.match(executor, /businessKey: studyLectureBusinessKey\(moduleCode, topic\)/);
assert.match(service, /studyLectureBusinessKey\(moduleCode, point\.name\)/);
assert.match(service, /private async findReadyLecture/);
assert.match(service, /findLatest\(\s*cycle\.examCycle\.id,\s*LearningAssetKind\.StudyLecture,/);
assert.match(service, /if \(!options\.regenerate\)/);
assert.match(service, /kind: 'ready'/);
assert.match(service, /kind: 'generating'/);
// Both entry points have to honour the reuse decision, not just one of them.
assert.match(view, /presentLectureEntry/);
assert.match(learningCenter, /entry\.kind === 'ready' \? \{ assetId: entry\.assetId \} : \{ taskId: entry\.task\.id \}/);

console.log('Study lecture library verification passed.');

function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}
