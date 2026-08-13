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

const repositoryFor = (bundle) => ({ async findBundle() { return bundle; } });

try {
  const curriculum = await server.ssrLoadModule('/src/modules/curriculum/public.ts');
  const bundle = curriculum.createBundledNationalCurriculum();
  const versionId = bundle.curriculum.id;

  const subjects = await new curriculum.GetExamSubjects(repositoryFor(bundle)).execute(versionId);

  // Subjects come from the package, in package order, not from application code.
  assert.deepEqual(subjects.map((item) => item.code), ['aptitude', 'essay', 'interview']);

  const aptitude = subjects[0];
  assert.equal(aptitude.name, '行政职业能力测验');
  assert.equal(aptitude.deliveryKind, curriculum.ExamDeliveryKind.Objective);
  // Modules replace the former hard-coded XC_MODULES list, ordered by sequence.
  assert.deepEqual(
    aptitude.modules.map((item) => item.name),
    ['判断推理', '言语理解与表达', '资料分析', '数量关系', '常识判断']
  );
  assert.equal(aptitude.mockExam.defaultQuestionCount, 120);
  assert.deepEqual(aptitude.mockExam.schemes.map((item) => item.code), ['national', 'provincial', 'compact']);
  assert.equal(aptitude.mockExam.focusTags.length, 7);

  const essay = subjects[1];
  assert.equal(essay.deliveryKind, curriculum.ExamDeliveryKind.Subjective);
  assert.equal(essay.mockExam.defaultDurationMinutes, 180);

  // Interview declares a delivery kind but no mock paper, so exam flows skip it.
  const interview = subjects[2];
  assert.equal(interview.deliveryKind, curriculum.ExamDeliveryKind.Subjective);
  assert.equal(interview.mockExam, undefined);

  // A subject whose delivery policy is missing or unparseable is not offered
  // rather than guessed at.
  const withoutAptitudePolicy = {
    ...bundle,
    assessmentPolicies: bundle.assessmentPolicies.filter((item) => item.id !== 'policy:aptitude:delivery:v1')
  };
  const skipped = await new curriculum.GetExamSubjects(repositoryFor(withoutAptitudePolicy)).execute(versionId);
  assert.deepEqual(skipped.map((item) => item.code), ['essay', 'interview']);

  const withBadKind = {
    ...bundle,
    assessmentPolicies: bundle.assessmentPolicies.map((item) => item.id === 'policy:essay:delivery:v1'
      ? { ...item, config: { ...item.config, deliveryKind: 'written' } }
      : item)
  };
  const rejected = await new curriculum.GetExamSubjects(repositoryFor(withBadKind)).execute(versionId);
  assert.deepEqual(rejected.map((item) => item.code), ['aptitude', 'interview']);

  // Draft policies must not win over the published one.
  const withDraftOverride = {
    ...bundle,
    assessmentPolicies: [
      ...bundle.assessmentPolicies,
      {
        ...bundle.assessmentPolicies.find((item) => item.id === 'policy:aptitude:delivery:v1'),
        id: 'policy:aptitude:delivery:v2',
        version: '2.0.0',
        status: 'draft',
        config: { deliveryKind: 'subjective' }
      }
    ]
  };
  const published = await new curriculum.GetExamSubjects(repositoryFor(withDraftOverride)).execute(versionId);
  assert.equal(published[0].deliveryKind, curriculum.ExamDeliveryKind.Objective);

  // Version resolution picks the highest published version, including 1.10 > 1.9.
  const withNewerPublished = {
    ...bundle,
    assessmentPolicies: [
      ...bundle.assessmentPolicies,
      {
        ...bundle.assessmentPolicies.find((item) => item.id === 'policy:aptitude:delivery:v1'),
        id: 'policy:aptitude:delivery:v110',
        version: '1.10.0',
        config: { deliveryKind: 'subjective' }
      }
    ]
  };
  const newest = await new curriculum.GetExamSubjects(repositoryFor(withNewerPublished)).execute(versionId);
  assert.equal(newest[0].deliveryKind, curriculum.ExamDeliveryKind.Subjective);

  assert.deepEqual(await new curriculum.GetExamSubjects({ async findBundle() { return undefined; } }).execute(versionId), []);

  console.log(`Exam subject projection verification passed (${subjects.length} subjects).`);
} finally { await server.close(); }
