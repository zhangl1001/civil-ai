import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

try {
  const [labels, curriculum, formats] = await Promise.all([
    server.ssrLoadModule('/src/domain/labels.ts'),
    server.ssrLoadModule('/src/modules/curriculum/public.ts'),
    server.ssrLoadModule('/src/domain/writtenFormats.ts')
  ]);

  // Before install nothing is known: readers degrade to the code, never crash.
  assert.equal(labels.practiceModuleLabel('judgment'), 'judgment');
  assert.equal(labels.practiceModuleLabel(''), '专项练习');
  assert.equal(labels.practiceModuleLabel(undefined), '专项练习');
  assert.deepEqual([...labels.curriculumModuleOptions()], []);

  const nodes = curriculum.createBundledNationalCurriculum().capabilityNodes;
  labels.installCurriculumLabels(nodes);

  // Names come from the package, short names win where the full name is long.
  assert.equal(labels.practiceModuleLabel('judgment'), '判断推理');
  assert.equal(labels.practiceModuleLabel('aptitude'), '行测');
  assert.equal(labels.practiceModuleLabel('verbal'), '言语理解');
  assert.equal(labels.practiceModuleLabel('interview'), '面试');
  assert.equal(labels.practiceModuleLabel('essay'), '申论');
  // Unknown codes still pass through rather than becoming a wrong label.
  assert.equal(labels.practiceModuleLabel('nonexistent_module'), 'nonexistent_module');

  // Reverse lookup accepts a code, the short name, and the full name.
  assert.equal(labels.practiceModuleCode('judgment'), 'judgment');
  assert.equal(labels.practiceModuleCode('判断推理'), 'judgment');
  assert.equal(labels.practiceModuleCode('行测'), 'aptitude');
  assert.equal(labels.practiceModuleCode('行政职业能力测验'), 'aptitude');
  assert.equal(labels.practiceModuleCode('言语理解'), 'verbal');
  assert.equal(labels.practiceModuleCode('言语理解与表达'), 'verbal');
  assert.equal(labels.practiceModuleCode('未知名称'), '未知名称');

  // Module pickers follow package order, not an application-side list.
  assert.deepEqual(
    labels.curriculumModuleOptions().map((item) => item.name),
    ['判断推理', '言语理解', '资料分析', '数量关系', '常识判断']
  );

  // Tool schemas keep a static code list; it must stay in step with the package.
  const packagedModuleCodes = labels.curriculumModuleOptions().map((item) => item.code);
  assert.deepEqual(
    [...labels.APTITUDE_MODULE_CODES].sort(),
    [...packagedModuleCodes].sort(),
    'APTITUDE_MODULE_CODES drifted from the curriculum module nodes'
  );

  assert.equal(labels.calendarTaskTitle('review', 'judgment'), '判断推理复习');
  assert.equal(labels.calendarTaskTitle('practice', 'verbal'), '言语理解练习');

  // A different package renames the UI without any application change.
  labels.installCurriculumLabels([
    {
      id: 'capability:law', curriculumVersionId: 'c', code: 'law', name: '国家统一法律职业资格考试',
      shortName: '法考', nodeType: 'subject', subject: 'law', module: 'law',
      sequence: 10, scoreWeight: 1, masteryPolicy: {}, status: 'active'
    },
    {
      id: 'capability:law:civil', curriculumVersionId: 'c', code: 'law.civil', name: '民法',
      nodeType: 'module', subject: 'law', module: 'civil',
      sequence: 20, scoreWeight: 0.3, masteryPolicy: {}, status: 'active'
    },
    {
      id: 'capability:law:retired', curriculumVersionId: 'c', code: 'law.retired', name: '已废止科目',
      nodeType: 'module', subject: 'law', module: 'retired',
      sequence: 30, scoreWeight: 0, masteryPolicy: {}, status: 'retired'
    }
  ]);
  assert.equal(labels.practiceModuleLabel('law'), '法考');
  assert.equal(labels.practiceModuleLabel('civil'), '民法');
  // Replacing the package must not leave the previous one's labels behind.
  assert.equal(labels.practiceModuleLabel('judgment'), 'judgment');
  // Retired nodes are not offered.
  assert.deepEqual(labels.curriculumModuleOptions().map((item) => item.code), ['civil']);

  // --- subjective answer formats ---------------------------------------------
  // Before install nothing is long-form, so callers never mis-route a paper.
  assert.equal(formats.isLongFormTopic('申发论述'), false);
  assert.deepEqual([...formats.writtenFormatNames()], []);

  formats.installWrittenFormats(curriculum.projectExamSubjects(curriculum.createBundledNationalCurriculum()));
  assert.deepEqual(
    [...formats.writtenFormatNames()],
    ['归纳概括', '综合分析', '提出对策', '贯彻执行', '申发论述']
  );
  // Replaces the name matching that used to be duplicated across six call sites.
  assert.equal(formats.isLongFormTopic('申发论述'), true);
  assert.equal(formats.isLongFormTopic('归纳概括'), false);
  assert.equal(formats.isLongFormTopic('  申发论述  '), true);
  assert.equal(formats.isLongFormTopic('未知题型'), false);
  assert.equal(formats.isLongFormTopic(undefined), false);
  assert.equal(formats.defaultShortFormTopic(), '归纳概括');
  assert.equal(formats.defaultLongFormTopic(), '申发论述');

  // A pack with no declared formats leaves callers with usable, empty defaults.
  formats.installWrittenFormats([]);
  assert.equal(formats.defaultShortFormTopic(), undefined);
  assert.equal(formats.defaultLongFormTopic(), undefined);
  assert.equal(formats.isLongFormTopic('申发论述'), false);

  console.log('Curriculum label verification passed.');
} finally { await server.close(); }
